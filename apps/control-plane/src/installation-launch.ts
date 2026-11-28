import { randomUUID } from 'node:crypto';
import { validateRequestBody } from '@platfolio/api-contract';
import type { RequestBodyOf, SuccessOf } from '@platfolio/api-contract/generated/types';
import type { ExtensionDescriptor } from '@platfolio/kernel';
import type { InstallationAuthorization, InstallationAuthorizationRequest, InstallationProvider, InstallationCheckpointObserver } from '../../../packages/contracts/src/installation-provider.ts';
import type { InstallationJournal } from '../../../packages/contracts/src/installation-journal.ts';
import type { Store } from '@platfolio/contracts';
import type { scoped } from './capabilities.ts';
import { badRequest, notFound, send, spec } from './respond.ts';
import { installationBootstrap } from './installation-bootstrap.ts';

const collection = '/api/v1/teams/{teamId}/marketplace/installation-launches';
export const installationAuthorizationCallback = '/api/v1/hosting/installation-authorization/callback';
type Progress = SuccessOf<'getHubInstallationLaunch'>;
type Input = RequestBodyOf<'startHubInstallation'>;
type MaintenanceInput = RequestBodyOf<'maintainHubInstallation'>;
type JournalOperation = (observer: InstallationCheckpointObserver, beforeWrite: () => Promise<void>,
  checkpoint: (change: (row: InstallationJournal) => Partial<InstallationJournal>) => Promise<void>) => Promise<void>;
type Session = {
  owner: string;
  team: string;
  until: number;
  pending?: InstallationAuthorizationRequest;
  grant?: InstallationAuthorization;
  starting?: boolean;
  failed?: boolean;
};
const leaseMs = 120_000;
const leaseDeadline = () => new Date(Date.now() + leaseMs).toISOString();
const journalState = (row: InstallationJournal) => row.removedAt ? 'removed' : row.state === 'running' && Date.parse(row.leaseUntil) <= Date.now() ? 'failed' : row.state;
const absent = () => notFound('installation launch', '');
const conflict = (message: string) => ({ status: 409, body: { error: 'conflict', message } });
const noCache = { 'cache-control': 'no-store' };

function projectProgress(row?: InstallationJournal, session?: Session): Progress {
  const state = session ? session.failed ? 'failed' : session.grant ? 'authorized' : 'authorizing' : row ? journalState(row) : 'failed';
  return {
    state,
    workspaces: [...session?.grant?.workspaces ?? []],
    events: row?.events ?? [],
    environments: row?.environments.map(({ name, origin }) => ({ name, origin })) ?? [],
    ...(row?.projectId ? { projectId: row.projectId } : {}),
  };
}

function runInstallation(store: Pick<Store, 'saveInstallationJournal'>, initial: InstallationJournal,
  active: Set<() => void>, operation: JournalOperation, apiOrigins?: Map<string, string>) {
  let journal = initial;
  let queue = Promise.resolve();
  let stopped = false;
  let updatedEnvironment: InstallationJournal['requested'][number] | undefined;
  const checkpoint = (change: (row: InstallationJournal) => Partial<InstallationJournal> = () => ({})) => {
    queue = queue.then(async () => {
      if (stopped || Date.parse(journal.leaseUntil) <= Date.now()) throw new Error('Launch lease expired');
      const next = { ...journal, ...change(journal), version: journal.version + 1, leaseUntil: leaseDeadline() };
      if (!await store.saveInstallationJournal(next)) throw new Error('Launch lease was superseded');
      journal = next;
    });
    return queue;
  };
  const step: InstallationCheckpointObserver['step'] = (label, state) => checkpoint((row) => ({
    events: [...row.events.slice(-99), { at: new Date().toISOString(), step: label, state }],
  }));
  const observer: InstallationCheckpointObserver = {
    step,
    project: (projectId) => checkpoint((row) => {
      if (row.projectId && row.projectId !== projectId) throw new Error('The provider reported a different project');
      return { projectId };
    }),
    environment: (name, origin) => checkpoint((row) => {
      const previous = row.environments.find((item) => item.name === name);
      const maintenance = row.maintenance;
      if (maintenance?.action === 'update') {
        if (maintenance.environment !== name || previous?.origin !== origin) throw new Error('The environment address changed');
        updatedEnvironment = name;
        return {};
      }
      if (!row.requested.includes(name) || previous) throw new Error('The provider reported an unexpected environment');
      const apiOrigin = apiOrigins?.get(name);
      return { environments: [...row.environments, { name, origin, ...(apiOrigin ? { apiOrigin } : {}), revision: row.revision }] };
    }),
  };
  const heartbeat = setInterval(() => void checkpoint().catch(stop), leaseMs / 4);
  heartbeat.unref();
  function stop() {
    stopped = true;
    clearInterval(heartbeat);
    active.delete(stop);
  }
  active.add(stop);
  void (async () => {
    try {
      await operation(observer, () => checkpoint(), checkpoint);
      await queue;
      if (initial.maintenance?.action === 'wipe') {
        await checkpoint(() => ({ state: 'ready', removedAt: new Date().toISOString(), maintenance: undefined, environments: [] }));
      } else {
        const update = initial.maintenance;
        if (!journal.projectId || !journal.requested.every((name) => journal.environments.some((item) => item.name === name)) ||
            (update?.action === 'update' && updatedEnvironment !== update.environment)) {
          throw new Error('The hosting operation did not verify its target');
        }
        await checkpoint((row) => ({
          state: 'ready', maintenance: undefined,
          ...(update?.action === 'update' ? { environments: row.environments.map((item) =>
            item.name === update.environment ? { ...item, revision: update.revision } : item) } : {}),
        }));
      }
    } catch {
      // A rejected provider result can leave accepted resources. Preserve their checkpoints.
      try {
        await step(journal.events.at(-1)?.step ?? 'Start launch', 'FAILED');
        await checkpoint(() => ({ state: 'failed' }));
      } catch {
        // A lost checkpoint leaves the journal fenced until its lease expires.
      }
    } finally {
      stop();
    }
  })();
}

export function installationLaunch(scopedRoute: typeof scoped, config?: { provider: InstallationProvider; returnTo: string },
  key?: string, request: typeof fetch = fetch): ExtensionDescriptor {
  const bootstrap = key && installationBootstrap(key);
  const sessions = new Map<string, Session>();
  const active = new Set<() => void>();
  function prune() {
    for (const [id, session] of sessions) {
      if (session.until <= Date.now() && !session.starting) sessions.delete(id);
    }
  }
  function visible(id: string, team: string, owner: string) {
    prune();
    const session = sessions.get(id);
    return session?.team === team && session.owner === owner ? session : undefined;
  }
  const scopedOwner: typeof scoped = (method, path, operation, action, handler) =>
    scopedRoute(method, path, operation, action, async (scope, request, params) =>
      config ? handler(scope, request, params) : absent());
  const result = (operation: 'getHubInstallationLaunch' | 'startHubInstallation' | 'maintainHubInstallation', status: 200 | 202, progress: Progress) =>
    ({ ...send(operation, status, progress), headers: noCache });

  return {
    id: 'installation-launch',
    requires: ['identity', 'store'],
    onBoot: () => {
      if (!config) return;
      const cleanup = setInterval(prune, 30_000);
      cleanup.unref();
      return () => { clearInterval(cleanup); sessions.clear(); for (const stop of active) stop(); };
    },
    routes: [
      scopedOwner('GET', '/api/v1/teams/{teamId}/marketplace/installation-offer', 'getHubInstallationOffer', 'marketplace.manage', async () =>
        send('getHubInstallationOffer', 200, { provider: config!.provider.id, revision: config!.provider.revision,
          ...(bootstrap ? { managedFirstSignIn: true } : {}) })),
      scopedOwner('GET', collection, 'listHubInstallationLaunches', 'marketplace.manage', async ({ context, teamId, personId }) => {
        const journals = await context.store.listInstallationJournals(teamId, personId);
        return { ...send('listHubInstallationLaunches', 200, journals.map((row) => ({
          id: row.id, name: row.name, workspaceId: row.workspaceId, state: journalState(row),
          requested: row.requested, verified: row.environments.map(({ name }) => name),
          installed: row.environments.map(({ name, revision }) => ({ name, revision: revision ?? row.revision })),
          canRemove: Boolean(row.projectId && !row.removedAt),
          ...(row.maintenance ? { maintenance: row.maintenance.action } : {}),
          ...(row.maintenance?.action === 'update' ? { maintenanceEnvironment: row.maintenance.environment } : {}),
        }))), headers: noCache };
      }),
      scopedOwner('POST', collection, 'authorizeHubInstallation', 'marketplace.manage', async ({ context, teamId, personId }, request) => {
        if (request.bodyError || !validateRequestBody(spec(), 'authorizeHubInstallation', request.body).ok) return badRequest('Choose one installation.');
        prune();
        const target = (request.body as RequestBodyOf<'authorizeHubInstallation'> | undefined)?.installationId;
        const row = target ? await context.store.getInstallationJournal(teamId, personId, target) : undefined;
        if (target && !row) return absent();
        if (row && journalState(row) === 'running') return conflict('Setup is still running. Check progress before retrying.');
        if (row && (row.provider !== config!.provider.id || row.removedAt)) return absent();
        if (sessions.size >= 500 || (target && sessions.get(target)?.starting)) return conflict('Wait for the active launch before trying again.');
        const id = row?.id ?? randomUUID();
        const pending = config!.provider.authorize();
        sessions.set(id, { owner: personId, team: teamId, until: Date.now() + 10 * 60_000, pending });
        return { ...send('authorizeHubInstallation', 201, { id, authorizationUrl: pending.url }), headers: noCache };
      }),
      scopedOwner('GET', collection + '/{launchId}', 'getHubInstallationLaunch', 'marketplace.manage', async ({ teamId, personId, context }, _req, params) => {
        const id = params.launchId ?? '';
        const session = visible(id, teamId, personId);
        const journal = await context.store.getInstallationJournal(teamId, personId, id);
        return journal || session ? result('getHubInstallationLaunch', 200, projectProgress(journal, session)) : absent();
      }),
      scopedOwner('DELETE', collection + '/{launchId}', 'forgetHubInstallation', 'marketplace.manage', async ({ teamId, personId, context }, _req, params) => {
        const id = params.launchId ?? '';
        const row = await context.store.getInstallationJournal(teamId, personId, id);
        if (!row) return absent();
        if (!row.removedAt || row.maintenance) return conflict('Verify the installation removal before deleting its record.');
        if (!await context.store.forgetInstallationJournal(teamId, personId, id, row.version)) return conflict('Installation history changed. Try again.');
        sessions.delete(id);
        return { status: 204, body: undefined };
      }),
      scopedOwner('GET', collection + '/{launchId}/first-sign-in/{environment}', 'getHubInstallationFirstSignIn', 'marketplace.manage', async ({ teamId, personId, context }, _req, params) => {
        const row = await context.store.getInstallationJournal(teamId, personId, params.launchId ?? '');
        const name = params.environment;
        if (!bootstrap || !row || row.removedAt || (name !== 'staging' && name !== 'production') || !row.managedFirstSignIn?.includes(name)) return absent();
        const origin = row.environments.find((item) => item.name === name)?.apiOrigin;
        if (!origin || !/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(origin)) return absent();
        try {
          const response = await request(origin + '/api/v1/setup', { redirect: 'error', signal: AbortSignal.timeout(4000) });
          if (!response.ok) throw new Error('Private setup status is unavailable');
          const setup = await response.json() as SuccessOf<'getPrivateSetup'>;
          return setup.temporaryPasswordActive === true && setup.smtpRequired === true
            ? { ...send('getHubInstallationFirstSignIn', 200, { temporaryPassword: bootstrap.password(row, name) }), headers: noCache }
            : absent();
        } catch { return { status: 503, body: { error: 'private-setup-unavailable', message: 'Could not confirm private sign-in status. Try again.' } }; }
      }),
      scopedOwner('PUT', collection + '/{launchId}', 'startHubInstallation', 'marketplace.manage', async ({ teamId, personId, context }, request, params) => {
        const id = params.launchId ?? '';
        const session = visible(id, teamId, personId);
        if (!session) return await context.store.getInstallationJournal(teamId, personId, id) ? conflict('Authorize the workspace again to continue.') : absent();
        if (request.bodyError || !validateRequestBody(spec(), 'startHubInstallation', request.body).ok) return badRequest('Choose a workspace and environments, and enter a valid owner email.');
        const input = request.body as Input;
        const { workspaceId, name, environments } = input;
        const grant = session.grant;
        if (!grant?.recover || session.starting || !grant.workspaces.some(({ id }) => id === workspaceId)) {
          return conflict('Authorize the workspace for this launch before continuing.');
        }
        session.starting = true;
        try {
          const row = await context.store.getInstallationJournal(teamId, personId, id);
          if (row && (row.workspaceId !== workspaceId || row.name !== name || row.provider !== config!.provider.id)) {
            return conflict('Use the original project name and workspace.');
          }
          if (row && journalState(row) === 'running') return conflict('An installation job is already running.');
          if (row?.maintenance || row?.removedAt) return conflict('Finish the current lifecycle operation from Connections.');
          const verified = row?.environments.map((item) => item.name) ?? [];
          if (row?.state === 'ready' && environments.some((item) => verified.includes(item))) {
            return conflict('Choose only environments that have not been installed.');
          }
          if (row && row.state !== 'ready' && (row.revision !== config!.provider.revision ||
              row.requested.length !== environments.length || !row.requested.every((item) => environments.includes(item)))) {
            return conflict('Resume the original release and environment choices before adding an environment.');
          }
          const journal: InstallationJournal = {
            ...row, id, teamId, personId, workspaceId, name, provider: config!.provider.id, revision: config!.provider.revision,
            requested: [...new Set([...verified, ...environments])], state: 'running',
            submitted: row?.submitted ?? [],
            environments: row?.environments.map((entry) => ({ ...entry, revision: entry.revision ?? row.revision })) ?? [],
            events: row?.events ?? [],
            ...(bootstrap ? { managedFirstSignIn: [...new Set([...row?.managedFirstSignIn ?? [], ...environments.filter((environment) => !row?.submitted.includes(environment))])] } : {}),
            version: row ? row.version + 1 : 0, leaseUntil: leaseDeadline(),
          };
          const audit = await context.store.appendAudit({ actorKind: 'user', actorRef: personId, action: 'installation.launch.request',
            target: teamId, detail: { ref: id, name, environment: environments.join(',') } });
          if (!audit.ok || !await context.store.saveInstallationJournal(journal)) {
            return conflict('Platfolio could not reserve this project. Check your existing installations before retrying.');
          }
          sessions.delete(id);
          const recover = grant.recover.bind(grant);
          const apiOrigins = new Map<string, string>();
          runInstallation(context.store, journal, active, (observer, _beforeWrite, checkpoint) =>
            recover({ ...input, environments: journal.requested }, observer, {
              id: journal.id,
              ...(journal.projectId ? { projectId: journal.projectId } : {}),
              verified: journal.environments.map(({ name }) => name), submitted: journal.submitted,
              observeApiOrigin: (environment, origin) => { apiOrigins.set(environment, origin); },
              ...(bootstrap ? { firstSignIn: async (environment: typeof journal.requested[number]) =>
                journal.managedFirstSignIn?.includes(environment) ? bootstrap.verifier(journal, environment) : { verifier: input.verifier, salt: input.salt } } : {}),
              beforeWrite: (environment) => checkpoint((current) => environment
                ? { submitted: [...new Set([...current.submitted, environment])] } : {}),
            }), apiOrigins);
          return result('startHubInstallation', 202, projectProgress(journal));
        } finally {
          delete session.starting;
        }
      }),
      scopedOwner('POST', collection + '/{launchId}/maintenance', 'maintainHubInstallation', 'marketplace.manage',
        async ({ teamId, personId, context }, request, params) => {
          const id = params.launchId ?? '';
          const row = await context.store.getInstallationJournal(teamId, personId, id);
          if (!row || row.removedAt) return absent();
          if (request.bodyError || !validateRequestBody(spec(), 'maintainHubInstallation', request.body).ok) {
            return badRequest('Choose an environment to update or confirm the project name.');
          }
          const input = request.body as MaintenanceInput;
          const session = visible(id, teamId, personId);
          const grant = session?.grant;
          if (!session || !grant?.maintain || session.starting || grant.expires <= Date.now() ||
              !grant.workspaces.some(({ id: workspace }) => workspace === row.workspaceId)) {
            return conflict('Authorize the original hosting workspace before continuing.');
          }
          if (!row.projectId || row.provider !== config!.provider.id || journalState(row) === 'running') {
            return conflict('Wait for the current job or verify the original project first.');
          }
          if (input.action === 'wipe' && input.confirmation !== row.name) return badRequest('Type the exact project name to confirm.');
          const revision = config!.provider.revision;
          if (input.action === 'update') {
            if (input.revision !== revision) return conflict('The offered release changed. Refresh Connections and review the new build.');
            const installed = row.environments.find(({ name }) => name === input.environment);
            const prior = row.maintenance;
            if (!installed || (row.state !== 'ready' &&
              (prior?.action !== 'update' || prior.environment !== input.environment || prior.revision !== revision))) {
              return conflict('Choose an installed environment or retry its previous update.');
            }
            if ((installed.revision ?? row.revision) === revision) return conflict('This environment is already on the offered release.');
          }
          session.starting = true;
          try {
            const maintenance = input.action === 'update'
              ? { action: input.action, environment: input.environment, revision }
              : { action: input.action };
            const next: InstallationJournal = {
              ...row, maintenance, state: 'running', version: row.version + 1, leaseUntil: leaseDeadline(),
            };
            const audit = await context.store.appendAudit({
              actorKind: 'user', actorRef: personId, action: 'installation.maintenance.request', target: teamId,
              detail: { ref: id, action: input.action, ...(input.action === 'update' ? { environment: input.environment, commit: revision } : {}) },
            });
            if (!audit.ok || !await context.store.saveInstallationJournal(next)) return conflict('Another operation changed this installation.');
            sessions.delete(id);
            const maintain = grant.maintain.bind(grant);
            const target = { id, name: row.name, projectId: row.projectId, workspaceId: row.workspaceId, requested: row.requested };
            runInstallation(context.store, next, active, (observer, beforeWrite) => maintain(target, maintenance, observer, beforeWrite));
            return result('maintainHubInstallation', 202, projectProgress(next));
          } finally {
            delete session.starting;
          }
        }),
      {
        method: 'GET', path: installationAuthorizationCallback, operationId: 'completeHubInstallationAuthorization',
        async handle(request) {
          prune();
          if (!config) return absent();
          const [code = '', state = '', issuer = '', error = ''] = ['code', 'state', 'iss', 'error'].map((key) => request.query.get(key) ?? '');
          if ([code, state, issuer, error].some((value) => value.length > 1024)) return absent();
          const session = [...sessions.values()].find((entry) => entry.pending?.state === state);
          if (!session?.pending) return absent();
          const pending = session.pending;
          delete session.pending;
          try {
            const grant = await pending.complete({ code, state, issuer, error });
            if (session.until > Date.now() && grant.workspaces.length) {
              session.grant = grant;
              session.until = Math.min(grant.expires, Date.now() + 10 * 60_000);
            } else session.failed = true;
          } catch {
            session.failed = true;
          }
          return { status: 303, body: null, headers: { ...noCache, location: config.returnTo, 'referrer-policy': 'no-referrer' } };
        },
      },
    ],
  };
}
