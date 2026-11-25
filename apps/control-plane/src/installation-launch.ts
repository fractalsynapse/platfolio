import { randomUUID } from 'node:crypto';
import { validateRequestBody } from '@platfolio/api-contract';
import type { RequestBodyOf, SuccessOf } from '@platfolio/api-contract/generated/types';
import type { ExtensionDescriptor } from '@platfolio/kernel';
import type { InstallationAuthorization, InstallationAuthorizationRequest, InstallationProvider } from '../../../packages/contracts/src/installation-provider.ts';
import type { scoped } from './capabilities.ts';
import { badRequest, notFound, send, spec } from './respond.ts';

const collection = '/api/v1/teams/{teamId}/marketplace/installation-launches';
export const installationAuthorizationCallback = '/api/v1/hosting/installation-authorization/callback';
type Progress = SuccessOf<'getHubInstallationLaunch'>;
type Input = RequestBodyOf<'startHubInstallation'>;
type Session = {
  owner: string;
  team: string;
  until: number;
  pending?: InstallationAuthorizationRequest;
  grant?: InstallationAuthorization;
  progress: Progress;
};
const absent = () => notFound('installation launch', '');
const conflict = (message: string) => ({ status: 409, body: { error: 'conflict', message } });

export function installationLaunch(scopedRoute: typeof scoped, config?: { provider: InstallationProvider; returnTo: string }): ExtensionDescriptor {
  const sessions = new Map<string, Session>();
  function prune() {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.until <= now && session.progress.state !== 'running') sessions.delete(id);
    }
  }
  function expireGrant(session: Session) {
    delete session.grant;
    session.progress.workspaces = [];
  }
  function finish(session: Session, state: 'ready' | 'failed') {
    expireGrant(session);
    delete session.pending;
    session.progress.state = state;
    session.until = Date.now() + 60 * 60_000;
  }
  function event(session: Session, step: string, state: 'WORKING' | 'READY' | 'FAILED') {
    session.progress.events.push({ at: new Date().toISOString(), step, state });
  }
  function visible(id: string | undefined, team: string, owner: string) {
    prune();
    const session = id && sessions.get(id);
    return session && session.team === team && session.owner === owner ? session : undefined;
  }
  const scopedOwner: typeof scoped = (method, path, operation, action, handler) =>
    scopedRoute(method, path, operation, action, async (scope, request, params) =>
      config ? handler(scope, request, params) : absent());
  const result = (operation: 'getHubInstallationLaunch' | 'startHubInstallation', status: 200 | 202, progress: Progress) =>
    ({ ...send(operation, status, progress), headers: { 'cache-control': 'no-store' } });

  return {
    id: 'installation-launch',
    requires: ['identity', 'store'],
    onBoot: () => {
      const cleanup = setInterval(prune, 30_000);
      cleanup.unref();
      return () => { clearInterval(cleanup); sessions.clear(); };
    },
    routes: [
      scopedOwner('GET', '/api/v1/teams/{teamId}/marketplace/installation-offer', 'getHubInstallationOffer', 'marketplace.manage', async () =>
        send('getHubInstallationOffer', 200, { provider: config!.provider.id, revision: config!.provider.revision })),
      scopedOwner('POST', collection, 'authorizeHubInstallation', 'marketplace.manage', async ({ teamId, personId }) => {
        prune();
        const current = [...sessions.values()].filter((session) => session.team === teamId && session.owner === personId);
        if (sessions.size >= 500 || current.some(({ progress }) => progress.state === 'running')) {
          return conflict('Wait for the active launch before starting another one.');
        }
        for (const session of current) {
          if (session.progress.state === 'authorizing' || session.progress.state === 'authorized') finish(session, 'failed');
        }
        const pending = config!.provider.authorize();
        const id = randomUUID();
        sessions.set(id, { owner: personId, team: teamId, until: Date.now() + 10 * 60_000, pending,
          progress: { state: 'authorizing', workspaces: [], events: [], environments: [] } });
        return { ...send('authorizeHubInstallation', 201, { id, authorizationUrl: pending.url }), headers: { 'cache-control': 'no-store' } };
      }),
      scopedOwner('GET', collection + '/{launchId}', 'getHubInstallationLaunch', 'marketplace.manage', async ({ teamId, personId }, _req, { launchId }) => {
        const session = visible(launchId, teamId, personId);
        return session ? result('getHubInstallationLaunch', 200, session.progress) : absent();
      }),
      scopedOwner('PUT', collection + '/{launchId}', 'startHubInstallation', 'marketplace.manage', async ({ teamId, personId, context }, request, { launchId }) => {
        const session = visible(launchId, teamId, personId);
        if (!session) return absent();
        if (request.bodyError || !validateRequestBody(spec(), 'startHubInstallation', request.body).ok) return badRequest('Choose a workspace and environments, and enter a valid owner email.');
        const { workspaceId, name, environments, ownerEmail, verifier, salt } = request.body as Input;
        const grant = session.grant;
        if (!grant || session.progress.state !== 'authorized' || !grant.workspaces.some(({ id }) => id === workspaceId)) {
          return conflict('Authorize the workspace for this launch before continuing.');
        }
        session.progress.state = 'running';
        expireGrant(session);
        try {
          const audit = await context.store.appendAudit({ actorKind: 'user', actorRef: personId, action: 'installation.launch.request',
            target: teamId, detail: { ref: launchId ?? '', name, environment: environments.join(',') } });
          if (!audit.ok) throw new Error('Launch audit was not saved');
        } catch {
          finish(session, 'failed');
          return conflict('Platfolio could not record this launch. Start a new authorization to try again.');
        }
        const observer = {
          step: (step: string, state: 'WORKING' | 'READY' | 'FAILED') => event(session, step, state),
          project: (id: string) => { session.progress.projectId = id; },
          environment: (name: Input['environments'][number], origin: string) => { session.progress.environments.push({ name, origin }); },
        };
        void grant.launch({ workspaceId, name, environments, ownerEmail, verifier, salt }, observer).then(
          () => finish(session, 'ready'),
          () => {
            event(session, session.progress.events.at(-1)?.step ?? 'Start launch', 'FAILED');
            finish(session, 'failed');
          },
        );
        return result('startHubInstallation', 202, session.progress);
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
            if (session.progress.state === 'authorizing' && session.until > Date.now() && grant.workspaces.length) {
              session.grant = grant;
              session.until = Math.min(grant.expires, Date.now() + 10 * 60_000);
              session.progress.workspaces = [...grant.workspaces];
              session.progress.state = 'authorized';
            } else finish(session, 'failed');
          } catch {
            finish(session, 'failed');
          }
          return { status: 303, body: null, headers: { location: config.returnTo, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } };
        },
      },
    ],
  };
}
