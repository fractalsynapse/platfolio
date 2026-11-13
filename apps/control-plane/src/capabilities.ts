import { randomBytes } from 'node:crypto';
import {
  AttestationSchema, checkBindingPolicy, CONTRACT_NAME, CONTRACT_VERSION, DispatchIntentSchema, InstanceSchema,
  reasonOf, decide, checkInvitationAcceptance, bindingImpact, normaliseName, rollupState, type BindingRecord, type CapabilityOffer, type PolicyAction, type VerifiedClaims,
} from '@platfolio/contracts';
import { RepositoryReadError } from '@platfolio/contracts';
import { ScmNotConfiguredError } from '@platfolio/kernel';
import { buildPlan, parseCompose } from '@platfolio/manifest';
import type { ExtensionDescriptor, KernelContext, Request, Response_, RouteDefinition } from '@platfolio/kernel';
import { badRequest, bearerToken, notFound, send, unauthorized } from './respond.ts';

/**
 * The control plane's capabilities, expressed as plugins (D40: everything is a plugin).
 *
 * Each descriptor declares the routes it owns and, when it has a background duty, a boot hook that returns its
 * own disposer. Nothing in this file knows what a Fiber is -- the kernel turns these into plugins -- so the API
 * surface is data, and a new capability is added by adding one object to the array, not by editing a switch.
 *
 * Dispatching handlers take `deps` as arguments rather than reaching for globals: the same descriptors run
 * against the in-memory store in tests and Postgres in the container, and a capability that captured a
 * singleton would only be honest in one of them.
 */
export interface CapabilityDeps {
  build: { version: string; commit: string; buildTime: string };
  /** Injected so the controller can be tested without waiting on a wall clock. */
  now?: () => Date;
  dispatchTtlMs?: number;
}

const nowOf = (deps: CapabilityDeps): Date => (deps.now?.() ?? new Date());
const REQUIRED_SCOPE = 'platfolio.user';

/** A request-time authorizer: the identity capability is read from the context, never captured at boot. */
async function authorize(context: KernelContext, request: Request): Promise<{ ok: true; claims: VerifiedClaims } | { ok: false; response: Response_ }> {
    const token = bearerToken(request.headers.authorization);
    if (!token) return { ok: false, response: unauthorized('no-credentials') };
    // Authentication first, authorization second: a token that is genuine but unscoped is a 403, and calling
    // that a 401 would make the spec's 403 unreachable and the refusal unreadable.
    const result = await context.identity.verifyAccessToken(token);
    if (result.ok === false) return { ok: false, response: unauthorized(result) };
    if (!result.claims.scope.includes(REQUIRED_SCOPE)) {
      return { ok: false, response: { status: 403, body: { error: 'insufficient-scope', message: `token lacks the ${REQUIRED_SCOPE} scope` } } };
    }
    return { ok: true, claims: result.claims };
}

type Body<T> = { ok: true; value: T | undefined } | { ok: false; error: string };

const bodyOf = <T>(request: Request): Body<T> => {
  if (request.bodyError !== undefined) return { ok: false, error: request.bodyError };
  return { ok: true, value: request.body === undefined ? undefined : (request.body as T) };
};

type Scope = { context: KernelContext; claims: VerifiedClaims; personId: string; role: 'owner' | 'member'; teamId: string };
type ScopedHandler = (scope: Scope, request: Request, params: Record<string, string>) => Promise<Response_>;

/**
 * The authorization boundary, resolved once per request.
 *
 * Handlers receive a scope or never run -- they cannot forget the check, because they are not given a context
 * to reach through. That is the whole design decision behind #173: authentication was already verified and
 * every team's rows still came back, so a rule that lives in each handler is a rule the next handler forgets.
 *
 * Cross-team reads answer 404, not 403. A 403 confirms the record exists, which is a finding in itself; the
 * caller is told nothing about what they cannot see.
 */
async function resolveScope(context: KernelContext, request: Request, params: Record<string, string>, action: PolicyAction, viaTeamId?: string): Promise<{ ok: true; scope: Scope } | { ok: false; response: Response_ }> {
  const auth = await authorize(context, request);
  if (auth.ok === false) return { ok: false, response: auth.response };
  // #177: the verified claims resolve to a **person**, and membership is read from the person. Keying teams
  // off a bare `sub` made two realms that mint the same subject string the same person, and left no way to
  // attach a machine client. The issuer here comes from the verified claims, so a caller cannot name one.
  const resolved = await context.store.resolvePerson({ issuer: auth.claims.issuer, subject: auth.claims.subject });
  if (resolved.ok === false) return { ok: false, response: { status: 503, body: { error: 'principal-unresolved', message: reasonOf(resolved) } } };
  const person = resolved.value.person;
  const teams = await context.store.teamsForPerson(person.id);
  if (teams.length === 0) {
    // Authenticated, and member of nothing. Not an error to explain -- a 404 on a specific resource and an
    // empty list on a collection, which is what an outsider is entitled to know.
    return { ok: false, response: { status: 404, body: { error: 'not-found', message: 'no such resource for this principal' } } };
  }
  let teamId = viaTeamId ?? params.teamId;
  if (teamId === undefined && params.instanceId !== undefined) {
    const found = await context.store.getInstance(params.instanceId);
    if (found.ok === false) return { ok: false, response: notFound('instance', params.instanceId) };
    teamId = found.value.teamId;
  }
  if (teamId === undefined) return { ok: false, response: badRequest('this operation needs a team or an instance the caller belongs to') };
  // One decision, from one table. Membership used to be the whole answer here, which made owner and member
  // identical and left D43's owner-only destroy nowhere to live.
  const membership = await context.store.getTeamMember(teamId, person.id);
  const verdict = decide({ action, membership: membership.ok ? { role: membership.value.role } : null });
  if (verdict.ok === false) {
    // 404 for a non-member, 403 for an under-roled one: the first protects existence, the second is advice
    // the caller is entitled to because they can already see the resource.
    return { ok: false, response: { status: verdict.status, body: { error: verdict.error.code, message: reasonOf(verdict.error) } } };
  }
  return { ok: true, scope: { context, claims: auth.claims, personId: person.id, role: verdict.role, teamId } };
}

/**
 * Which operation authorises as what. Populated by `scoped()` at build time rather than maintained by hand,
 * so the route-table test can assert coverage over the routes that actually exist -- a hand-written list would
 * silently keep passing after someone added a route and forgot to add it here, which is the exact mistake this
 * table is meant to prevent.
 */
export const OPERATION_ACTIONS = new Map<string, PolicyAction>();

/** Record what an operation authorises as. `scoped()` does this for its own routes; the handful of handlers
 *  that resolve a team from a body, or filter a list instead of gating one resource, register explicitly --
 *  otherwise the coverage test would pass for the routes that happen to use the wrapper and ignore the rest. */
function actionFor(operationId: string, action: PolicyAction): void {
  OPERATION_ACTIONS.set(operationId, action);
}

/** Wraps a handler so the scope is resolved before it runs. Team-scoped routes are built with this only. */
function scoped(method: string, path: string, operationId: string, action: PolicyAction, handler: ScopedHandler): RouteDefinition {
  actionFor(operationId, action);
  return {
    method,
    path,
    operationId,
    handle: async (request, params, context) => {
      // No default action: a new route cannot exist without naming what it authorises. That is the whole
      // difference between a policy and a habit, and the route-table test enforces the naming.
      const resolved = await resolveScope(context, request, params, action);
      if (resolved.ok === false) return resolved.response;
      return handler(resolved.scope, request, params);
    },
  };
}

export function buildCapabilities(deps: CapabilityDeps): ExtensionDescriptor[] {
  const now = () => nowOf(deps);

  // Registered here rather than inside a handler, so the coverage assertion sees the surface that exists
  // instead of the surface that happened to be exercised first. These are the operations that resolve a team
  // from a body, or filter a list by membership, instead of going through `scoped()` -- nothing else would
  // record them, and an unlabelled operation is indistinguishable from an unguarded one.
  actionFor('createInstance', 'instance.create');
  actionFor('listInstances', 'instance.read');
  actionFor('listAudit', 'audit.read');

  const core: ExtensionDescriptor = {
    id: 'core',
    requires: ['identity', 'store'],
    routes: [
      {
        method: 'GET', path: '/healthz', operationId: 'getHealth',
        handle: async (_request, _params, _context) => {
          const { createHash } = await import('node:crypto');
          const token = createHash('sha256').update(`${deps.build.commit}\u0000${deps.build.version}`).digest('hex').slice(0, 16);
          return send('getHealth', 200, { status: 'ok', livenessToken: token });
        },
      },
      {
        method: 'GET', path: '/readyz', operationId: 'getReady',
        handle: async (_request, _params, context) => {
          const checks: Array<{ name: string; status: 'ok' | 'degraded' | 'failed' | 'not-configured'; detail?: string }> = [];
          const identity = context.identity.describe();
          checks.push(identity.provider === 'unattached'
            ? { name: 'identity', status: 'failed', detail: 'identity is configured but has no key set -- every token will be refused' }
            : { name: 'identity', status: 'ok' });
          const storeInfo = context.store.describe();
          const alive = await context.store.ping();
          if (storeInfo.driver === 'memory') {
            // Degraded even when it answers, and always with the reason. A development store that reports
            // `ok` is how a stack that loses every record on restart gets mistaken for one that is ready to
            // serve a tenant.
            checks.push({ name: 'database', status: 'degraded', detail: 'in-memory store: records are lost on restart, so this is a development stack' });
          } else {
            checks.push(alive
              ? { name: 'database', status: 'ok' }
              : { name: 'database', status: 'failed', detail: 'the store could not be reached, or the schema is not migrated' });
          }
          const body = { status: checks.some((c) => c.status === 'failed') ? 'not-ready' : 'ready', checks } as const;
          return send('getReady', body.status === 'ready' ? 200 : 503, body);
        },
      },
      {
        method: 'GET', path: '/version', operationId: 'getVersion',
        handle: async () => send('getVersion', 200, {
          name: 'control-plane', version: deps.build.version, commit: deps.build.commit, buildTime: deps.build.buildTime,
          // Import, never retype: the contract version this build speaks is a fact about the code, and a
          // literal here would silently disagree with packages/contracts the day the contract moves.
          providerContract: { name: CONTRACT_NAME, version: CONTRACT_VERSION },
        }),
      },
      {
        method: 'GET', path: '/api/v1/whoami', operationId: 'getWhoami',
        handle: async (request, _params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          // Allow-listed projection. The claims object is not echoed: a token must not be able to smuggle
          // content into a response body, a log line, or a UI.
          const claims = auth.claims;
          return send('getWhoami', 200, {
            subject: claims.subject, issuer: claims.issuer, audience: claims.audience, clientId: claims.clientId,
            scope: claims.scope, expiresAt: claims.expiresAt, tenantAuthority: false,
          });
        },
      },
    ],
  };

  const instances: ExtensionDescriptor = {
    id: 'instances',
    requires: ['store', 'identity', 'scm'],
    routes: [
      {
        method: 'GET', path: '/api/v1/instances', operationId: 'listInstances',
        handle: async (request, _params, context) => {
          // A filtered read of the caller's own teams. It still names its action, because an unlabelled
          // operation is indistinguishable from an unguarded one.
          actionFor('listInstances', 'instance.read');
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const resolved = await context.store.resolvePerson({ issuer: auth.claims.issuer, subject: auth.claims.subject });
          if (resolved.ok === false) return { status: 503, body: { error: 'principal-unresolved', message: reasonOf(resolved) } };
          const teams = await context.store.teamsForPerson(resolved.value.person.id);
          // Filtered by membership, not by "there is only one team in the demo". An outsider sees an empty
          // list, which is the same answer as a member of an empty team -- no signal about what exists.
          const visible = await Promise.all(teams.map((teamId) => context.store.listInstances(teamId)));
          // Each instance carries its environment rows, so a client never has to guess whether `state` is
          // production's truth or the average of everything (#179).
          const instances = visible.flat();
          const withEnvs = await Promise.all(instances.map(async (instance) => ({
            ...instance, environments: await context.store.listInstanceEnvironments(instance.id),
          })));
          return send('listInstances', 200, withEnvs);
        },
      },
      {
        method: 'POST', path: '/api/v1/instances', operationId: 'createInstance',
        handle: async (request, params, context) => {
          actionFor('createInstance', 'instance.create');
          const parsed = bodyOf<{ teamId?: unknown; name?: unknown; template?: unknown }>(request);
          if (parsed.ok === false) return badRequest(parsed.error);
          const input = InstanceSchema.pick({ teamId: true, name: true, template: true }).safeParse(parsed.value ?? {});
          if (!input.success) return badRequest(input.error.issues.map((i) => `${i.path.join('.') || '<root>'} ${i.message}`).join('; '));
          // Membership is checked against the team named in the body, which resolveScope cannot read from
          // params. Passing it explicitly keeps the decision in one place: the caller may act for that team or
          // get the same 404 as if the team did not exist.
          const resolved = await resolveScope(context, request, params, 'instance.create', input.data.teamId);
          if (resolved.ok === false) return resolved.response;
          const created = await context.store.createInstance(input.data);
          if (created.ok === false) return { status: 400, body: { error: created.code, message: reasonOf(created) } };
          await context.store.appendAudit({ actorKind: 'user', actorRef: resolved.scope.claims.subject, action: 'instance.create', target: created.value.id, detail: { template: created.value.template, teamId: created.value.teamId } });
          // A 201 records intent. Nothing about provisioning is claimed, because nothing was verified
          // (D30 law 1): state stays `pending` and only a reconciled attestation moves it.
          return send('createInstance', 201, created.value);
        },
      },
      {
        method: 'GET', path: '/api/v1/me', operationId: 'getCurrentPerson',
        handle: async (request, _params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const resolved = await context.store.resolvePerson({ issuer: auth.claims.issuer, subject: auth.claims.subject });
          if (resolved.ok === false) return { status: 503, body: { error: 'principal-unresolved', message: reasonOf(resolved) } };
          const { person } = resolved.value;
          const identities = await context.store.listIdentities(person.id);
          const memberships = await context.store.teamsForPerson(person.id);
          const teams: Array<{ teamId: string; name: string; role: 'owner' | 'member' }> = [];
          for (const teamId of memberships) {
            const team = await context.store.getTeam(teamId);
            const member = await context.store.getTeamMember(teamId, person.id);
            if (team.ok && member.ok) teams.push({ teamId, name: team.value.name, role: member.value.role });
          }
          // Proofs are listed as issuer+subject only. A token, a session id, or an email taken from the
          // request would all be different answers -- the caller is told who they are, not allowed to say.
          return send('getCurrentPerson', 200, {
            personId: person.id, kind: person.kind,
            identities: identities.map((i) => ({ issuer: i.issuer, subject: i.subject })),
            teams,
          });
        },
      },
      scoped('DELETE', '/api/v1/instances/{instanceId}', 'destroyInstance', 'instance.destroy', async (scope, _request, params) => {
        // The reason #176 exists. `decide` already proved this caller is an OWNER of the team that holds the
        // instance (D43); this proves the destroy will not strand something that is running.
        const consumers = await scope.context.store.listConsumers(params.instanceId ?? '');
        if (consumers.length > 0) {
          // 409 naming the dependants. Not 202-with-a-warning: an API that says yes to a destructive operation
          // it knows is unsafe has made the tenant's outage its own.
          return {
            status: 409,
            body: { error: 'conflict', message: `removing this instance would strand: ${bindingImpact(consumers).join('; ')}` },
          };
        }
        // Recorded, not claimed done: provider teardown is a dispatch the action executes and attests (#196).
        // Reporting completed destruction the control plane has not performed is a lie with consequences -- a
        // tenant reads it as licence to reclaim their own compute.
        const moved = await scope.context.store.updateInstanceState(params.instanceId ?? '', 'deprovisioning');
        if (moved.ok === false) return { status: moved.code === 'not-found' ? 404 : 400, body: { error: moved.code, message: reasonOf(moved) } };
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'instance.destroy', target: moved.value.id, detail: { from: scope.role, state: 'deprovisioning' } });
        return send('destroyInstance', 202, { instanceId: moved.value.id, state: 'deprovisioning', recorded: true });
      }),
      scoped('GET', '/api/v1/instances/{instanceId}', 'getInstance', 'instance.read', async (scope, _request, params) => {
        const found = await scope.context.store.getInstance(params.instanceId ?? '');
        // resolveScope already proved the instance exists and is the caller's team's; a mismatch here means the
        // row went away mid-request, which is a 404 like any other missing record.
        if (found.ok === false) return notFound('instance', params.instanceId ?? '');
        return send('getInstance', 200, { ...found.value, environments: await scope.context.store.listInstanceEnvironments(found.value.id) });
      }),
      scoped('PUT', '/api/v1/instances/{instanceId}/plan', 'putPlan', 'instance.plan.write', async (scope, request, params) => {
        const parsed = bodyOf<{ plan?: unknown }>(request);
        if (parsed.ok === false) return badRequest(parsed.error);
        const plan = parsed.value?.plan;
        if (!plan || typeof plan !== 'object') return badRequest('body must be { plan: object }');
        const hash = (plan as { planHash?: unknown }).planHash;
        if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
          // The digest on the plan is authoritative. Re-deriving one here would recreate the bug that made
          // every honest attestation fail with 400: two implementations of a truth that has one home.
          return badRequest(`plan must carry a bare 64-hex planHash computed by buildPlan, got ${typeof hash === 'string' ? hash.slice(0, 24) : String(hash)}`);
        }
        const stored = await scope.context.store.putPlan(params.instanceId ?? '', plan, hash);
        if (stored.ok === false) return { status: 400, body: { error: stored.code, message: reasonOf(stored) } };
        await scope.context.store.updateInstanceState(params.instanceId ?? '', 'pending', { desiredPlanHash: hash });
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'plan.register', target: params.instanceId ?? '', detail: { planHash: hash.slice(0, 12) } });
        return send('putPlan', 200, { instanceId: params.instanceId ?? '', planHash: hash });
      }),
      scoped('POST', '/api/v1/instances/{instanceId}/plan/from-repository', 'registerPlanFromRepository', 'instance.plan.write', async (scope, request, params) => {
        // #172's middle, and the reason the spec was written before this function existed: until now the only
        // way to record a plan was for a human to hold a checkout and run a script that read their own
        // filesystem (`open-install-pr.ts --platform .`, which was `--platform selfhost` until D50 moved the
        // platform files to the root). That default is still in the tool, which is
        // exactly how a dry run against an unrelated tenant repository reported platfolio's own platform.
        const id = params.instanceId ?? '';
        const found = await scope.context.store.getInstance(id);
        if (found.ok === false) return notFound('instance', id);
        const instance = found.value;
        const pinned = instance.templateRef;
        if (!pinned) {
          return {
            status: 400,
            body: {
              error: 'no-pinned-source',
              message: `instance "${id}" cites no templateRef {repo, commitSha}; platfolio builds plans only from a pinned commit (D29) -- a branch name would let a plan be built from content that no longer exists by the time it is applied`,
            },
          };
        }
        const body = bodyOf<{ path?: string; overlayPath?: string }>(request);
        if (body.ok === false) return badRequest(body.error);
        const mainPath = body.value?.path ?? 'compose.yaml';
        const overlayPath = body.value?.overlayPath ?? 'compose.prod.yaml';

        const files: { path: string; blobSha: string; size: number }[] = [];
        const docs: string[] = [];
        try {
          const main = await scope.context.scm.readFile({ repo: pinned.repo, ref: pinned.commitSha, path: mainPath });
          docs.push(main.content);
          files.push({ path: main.path, blobSha: main.sha, size: main.size });
          // A missing overlay is a legitimate state: every service may already carry its own digest. Any
          // OTHER read failure is not, and propagates -- "it is not there" and "we could not read it" send an
          // operator to different places, which is the whole lesson of #130.
          try {
            const overlay = await scope.context.scm.readFile({ repo: pinned.repo, ref: pinned.commitSha, path: overlayPath });
            docs.push(overlay.content);
            files.push({ path: overlay.path, blobSha: overlay.sha, size: overlay.size });
          } catch (error) {
            if (!(error instanceof RepositoryReadError) || error.failure.kind !== 'not-found') throw error;
          }
        } catch (error) {
          if (error instanceof ScmNotConfiguredError) return { status: 503, body: { error: error.code, message: error.message } };
          if (error instanceof RepositoryReadError) {
            const detail = error.failure.detail.slice(0, 400);
            if (error.failure.kind === 'forbidden') return { status: 403, body: { error: 'repository-not-installed', message: detail } };
            if (error.failure.kind === 'not-a-file' || error.failure.kind === 'too-large') return { status: 400, body: { error: `manifest-${error.failure.kind}`, message: detail } };
            return { status: 400, body: { error: 'source-unreadable', message: detail } };
          }
          return { status: 400, body: { error: 'source-unreadable', message: (error as Error).message.slice(0, 400) } };
        }

        const parsed = parseCompose(docs);
        if (!parsed.manifest) {
          return {
            status: 400,
            body: {
              error: 'manifest-invalid',
              // Quoted from the renderer rather than paraphrased: it already names the service and the reason
              // (#84's unpinned refusal is the one an operator most needs to read unchanged), and a second
              // voice between a tenant and that reason is how a message becomes a guess.
              message: parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ').slice(0, 500),
            },
          };
        }

        const plan = buildPlan(parsed.manifest, { instanceId: id, teamId: instance.teamId });
        // One hash, one home. `plan.planHash` is handed to the store exactly as PUT …/plan demands a caller
        // supply it; re-deriving a digest in the API is the bug that made every honest attestation fail 400.
        const stored = await scope.context.store.putPlan(id, plan, plan.planHash);
        if (stored.ok === false) return { status: 400, body: { error: stored.code, message: reasonOf(stored) } };
        await scope.context.store.updateInstanceState(id, 'pending', { desiredPlanHash: plan.planHash });
        await scope.context.store.appendAudit({
          actorKind: 'user', actorRef: scope.personId, action: 'plan.register', target: id,
          // `detail` is a record, not a sentence: an audit row that must be read by eye is a log line wearing a
          // schema. Values are names and digest prefixes only -- never a token, never a key.
          detail: { repo: pinned.repo, commit: pinned.commitSha.slice(0, 12), files: files.map((f) => f.path).join(', ') },
        });
        const warnings = parsed.issues.map((issue) => ({ code: 'compose-issue', message: `${issue.path}: ${issue.message}` }));
        return send('registerPlanFromRepository', 200, {
          instanceId: id,
          planHash: plan.planHash,
          source: { repo: pinned.repo, ref: pinned.commitSha, files },
          summary: {
            services: plan.environments.reduce((n, e) => n + e.services.length, 0),
            databases: plan.environments.reduce((n, e) => n + e.databases.length, 0),
            environments: plan.environments.map((e) => e.name),
          },
          ...(warnings.length ? { warnings } : {}),
        });
      }),
    ],
  };

  const dispatches: ExtensionDescriptor = {
    id: 'dispatches',
    requires: ['store', 'identity', 'scm'],
    routes: [
      scoped('POST', '/api/v1/instances/{instanceId}/dispatches', 'createDispatch', 'instance.dispatch', async (scope, request, params) => {
        const instanceId = params.instanceId ?? '';
        const plan = await scope.context.store.getPlan(instanceId);
        if (plan.ok === false) return notFound('plan', instanceId);
        const parsed = bodyOf<{ action?: 'apply' | 'destroy'; environment?: string }>(request);
        if (parsed.ok === false) return badRequest(parsed.error);
        const action = parsed.value?.action ?? 'apply';
        const environment = parsed.value?.environment ?? 'production';
        const issued = now();
        const ttl = deps.dispatchTtlMs ?? 15 * 60_000;
        const created = await scope.context.store.createDispatch({
          instanceId,
          // The dispatch copies the plan at issue time: a runner must not be authorised for a desired state
          // that moved while its workflow sat in a queue.
          nonce: randomBytes(16).toString('hex'),
          planHash: plan.value.planHash,
          action,
          environment,
          issuedAt: issued.toISOString(),
          expiresAt: new Date(issued.getTime() + ttl).toISOString(),
          plan: plan.value.plan,
        });
        if (created.ok === false) return { status: 400, body: { error: created.code, message: reasonOf(created) } };
        const instance = await scope.context.store.getInstance(instanceId);
        const intent = DispatchIntentSchema.parse({
          instanceId, teamId: instance.ok ? instance.value.teamId : 'unknown',
          dispatchId: created.value.id, nonce: created.value.nonce, planHash: created.value.planHash,
          action, environment, issuedAt: created.value.issuedAt, expiresAt: created.value.expiresAt,
        });
        // Target is the team-owned instance, not the dispatch id. The audit list is filtered by what the
        // caller's teams own, so a row addressed to a dispatch would be invisible to the very people whose
        // action it records -- which the authorization filter caught the first time it ran.
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'dispatch.create', target: instanceId, detail: { dispatchId: created.value.id, action, environment } });
        return send('createDispatch', 201, { intent });
      }),
      scoped('POST', '/api/v1/instances/{instanceId}/dispatches/{dispatchId}/trigger', 'triggerDispatch', 'instance.dispatch', async (scope, request, params) => {
        // The other half of the middle. Recording a dispatch states platfolio's INTENT; nothing happens until
        // the tenant's own workflow runs, because only the tenant's credentials may touch the tenant's provider
        // account (D24). This is the call that asks GitHub for that run.
        const id = params.instanceId ?? '';
        const dispatchId = params.dispatchId ?? '';
        const dispatch = await scope.context.store.getDispatch(dispatchId);
        if (dispatch.ok === false) return notFound('dispatch', dispatchId);
        if (dispatch.value.instanceId !== id) return notFound('dispatch', dispatchId);
        if (dispatch.value.consumedAt !== null) {
          return {
            status: 409,
            body: {
              error: 'dispatch-consumed',
              message: `dispatch ${dispatchId} was already fetched by a runner at ${dispatch.value.consumedAt}; triggering again would send a second runner to fetch a plan that is gone`,
            },
          };
        }
        if (new Date(dispatch.value.expiresAt).getTime() < Date.now()) {
          return { status: 409, body: { error: 'dispatch-expired', message: `dispatch ${dispatchId} expired at ${dispatch.value.expiresAt}` } };
        }
        const body = bodyOf<{ ref?: string; workflow?: string }>(request);
        if (body.ok === false) return badRequest(body.error);
        const ref = body.value?.ref;
        if (!ref) return badRequest("a trigger needs the branch or tag GitHub should run on; the plan's commit travels as an input, not as the ref");
        const workflow = body.value?.workflow ?? 'platfolio-managed.yml';

        const instance = await scope.context.store.getInstance(id);
        if (instance.ok === false) return notFound('instance', id);
        const pinned = instance.value.templateRef;
        if (!pinned) {
          return { status: 400, body: { error: 'no-pinned-source', message: `instance "${id}" cites no templateRef {repo, commitSha}, so platfolio does not know which repository owns its workflow` } };
        }
        if (scope.context.scm.configured === false) {
          return { status: 503, body: { error: 'source-control-not-configured', message: 'platfolio has no GitHub App installation configured, so it cannot ask the tenant repository to run' } };
        }

        // The six inputs are exactly the ones the rendered workflow declares as required. A seventh (the nonce
        // is deliberately NOT written to audit below) is how the runner authenticates its plan fetch; it is a
        // secret handed to the tenant's own environment, which is the only place it can be used.
        const result = await scope.context.scm.dispatchWorkflow({
          repo: pinned.repo,
          workflow,
          ref,
          inputs: {
            action: dispatch.value.action,
            environment: dispatch.value.environment,
            instance_id: id,
            dispatch_id: dispatchId,
            nonce: dispatch.value.nonce,
            plan_hash: dispatch.value.planHash,
          },
        });
        if (result.kind !== 'requested') {
          // The provider's own words, forwarded. A refused dispatch is otherwise undebuggable: the runner never
          // started, so there are no run logs to read, and the only evidence is this response.
          return { status: 502, body: { error: result.kind, message: ('detail' in result ? result.detail : 'source control refused the dispatch').slice(0, 500) } };
        }
        await scope.context.store.appendAudit({
          actorKind: 'user', actorRef: scope.personId, action: 'dispatch.trigger', target: id,
          detail: { repo: pinned.repo, ref, workflow, dispatchId, planHash: dispatch.value.planHash },
        });
        return send('triggerDispatch', 202, { instanceId: id, dispatchId, repo: pinned.repo, ref, workflow, state: 'requested' });
      }),
      {
        method: 'GET', path: '/api/v1/instances/{instanceId}/dispatches/{dispatchId}', operationId: 'getDispatchPlan',
        handle: async (_request, params, context) => {
          // Deliberately not team-scoped: the caller is GitHub Actions, which holds the dispatch secret and
          // no user token. Its authority is the single-use nonce, which the store enforces, and the runner's
          // *identity* is the #159 gap. Wrapping this route in a user guard would break the one flow the
          // platform exists to run.
          const dispatchId = params.dispatchId ?? '';
          const existing = await context.store.getDispatch(dispatchId);
          if (existing.ok === false) return notFound('dispatch', dispatchId);
          if (existing.value.instanceId !== params.instanceId) return notFound('dispatch', dispatchId);
          const consumed = await context.store.consumeDispatch(dispatchId);
          if (consumed.ok === false) {
            if (consumed.code === 'consumed') return { status: 409, body: { error: 'nonce-consumed', message: reasonOf(consumed) } };
            if (consumed.code === 'expired') return { status: 409, body: { error: 'dispatch-expired', message: reasonOf(consumed) } };
            return { status: 500, body: { error: consumed.code, message: reasonOf(consumed) } };
          }
          return send('getDispatchPlan', 200, { plan: consumed.value.plan, planHash: consumed.value.planHash, issuedAt: consumed.value.issuedAt, expiresAt: consumed.value.expiresAt });
        },
      },
      {
        method: 'POST', path: '/api/v1/attestations', operationId: 'postAttestation',
        handle: async (request, _params, context) => {
          // Same reasoning as the runner's fetch: bound by nonce, plan hash and one-row-per-dispatch, not by
          // team membership. Acceptance policy is `checkAttestationPolicy`, shared by every store driver.
          const parsed = bodyOf<unknown>(request);
          if (parsed.ok === false) return badRequest(parsed.error);
          const attestation = AttestationSchema.safeParse(parsed.value ?? {});
          if (!attestation.success) return { status: 400, body: { error: 'invalid-attestation', message: attestation.error.issues.map((i) => `${i.path.join('.') || '<root>'} ${i.message}`).join('; ').slice(0, 200) } };
          const recorded = await context.store.recordAttestation(attestation.data, now().toISOString());
          if (recorded.ok === false) {
            const status = recorded.code === 'conflict' && reasonOf(recorded).includes('already attested') ? 409 : 400;
            return { status, body: { error: recorded.code, message: reasonOf(recorded) } };
          }
          await context.store.appendAudit({ actorKind: 'runner', actorRef: recorded.value.dispatchId, action: 'attestation.record', target: recorded.value.instanceId, detail: { result: recorded.value.result, resources: recorded.value.resources.length } });
          return send('postAttestation', 202, { accepted: true, dispatchId: recorded.value.dispatchId, result: recorded.value.result });
        },
      },
      scoped('GET', '/api/v1/instances/{instanceId}/latest-attestation', 'getLatestAttestation', 'instance.read', async (scope, _request, params) => {
        const latest = await scope.context.store.latestAttestation(params.instanceId ?? '');
        return latest.ok ? send('getLatestAttestation', 200, latest.value) : notFound('attestation', params.instanceId ?? '');
      }),
    ],
  };

  const audit: ExtensionDescriptor = {
    id: 'audit',
    requires: ['store', 'identity'],
    routes: [{
      method: 'GET', path: '/api/v1/audit', operationId: 'listAudit',
      handle: async (request, _params, context) => {
        const auth = await authorize(context, request);
        if (auth.ok === false) return auth.response;
        const limit = Number(request.query.get('limit') ?? 50);
        if (!Number.isFinite(limit) || limit < 1 || limit > 200) return badRequest('limit must be between 1 and 200');
        const resolved = await context.store.resolvePerson({ issuer: auth.claims.issuer, subject: auth.claims.subject });
          if (resolved.ok === false) return { status: 503, body: { error: 'principal-unresolved', message: reasonOf(resolved) } };
          const teams = await context.store.teamsForPerson(resolved.value.person.id);
        const owned = new Set((await Promise.all(teams.map((teamId) => context.store.listInstances(teamId)))).flat().map((i) => i.id));
        const rows = await context.store.recentAudit(200);
        // Audit rows are addressed by instance id, or by the instance itself for dispatches. Anything not
        // owned by one of the caller's teams is simply not in the answer -- including rows that mention
        // resources that do not exist, which would otherwise be a way to probe for them.
        const visible = rows.filter((row) => owned.has(row.target) || owned.has(row.target.replace(/^instance\//, '')));
        return send('listAudit', 200, visible.slice(0, limit));
      },
    }],
  };

  // The controller: Slice 2's promise that something other than a human reads what the runner reported.
  const controller: ExtensionDescriptor = {
    id: 'controller',
    requires: ['store'],
    onBoot: (context: KernelContext) => {
      const intervalMs = Number(process.env.PLATFOLIO_RECONCILE_INTERVAL_MS ?? 15_000);
      let sweeps = 0;
      let running = false;
      const sweep = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
          const instances = await context.store.listInstances();
          for (const instance of instances) {
            const latest = await context.store.latestAttestation(instance.id);
            if (latest.ok === false) continue;
            const attested = latest.value;
            // A plan-hash disagreement with the *dispatch* was already refused at the door. What is left for
            // the controller is the honest part: an attested result moves the recorded state, and it records
            // which digest it was for. No read of GitHub, no reading of logs -- the attestation is the input.
                        // ok/noop -> live, partial -> degraded (some resources landed and some did not), failed -> failed.
            // Anything else leaves the state alone rather than inventing a transition.
            const next = attested.result === 'ok' || attested.result === 'noop' ? 'live'
              : attested.result === 'partial' ? 'degraded'
                : attested.result === 'failed' ? 'failed'
                  : instance.state;
            // Per environment (#179): an attestation names one environment, and recording it as "the
            // instance's state" was the lie that staging degraded could erase production live.
            const wrote = await context.store.setInstanceEnvironment({
              instanceId: instance.id, environment: attested.environment, state: next,
              appliedPlanHash: attested.planHash, attestationId: attested.dispatchId,
            });
            if (wrote.ok === false) {
              context.logger.error(`controller: environment state write refused for ${instance.id}/${attested.environment}: ${reasonOf(wrote)}`);
              continue;
            }
            const rows = await context.store.listInstanceEnvironments(instance.id);
            const rollup = rollupState(rows);
            if (rollup === instance.state && instance.lastAppliedPlanHash === attested.planHash) continue;
            const updated = await context.store.updateInstanceState(instance.id, rollup, { lastAppliedPlanHash: attested.planHash });
            if (updated.ok) {
              await context.store.appendAudit({
                actorKind: 'controller', actorRef: `sweep-${String(sweeps)}`, action: 'instance.state', target: instance.id,
                detail: { from: instance.state, to: rollup, environment: attested.environment, environmentState: next, dispatchId: attested.dispatchId },
              });
            }
          }
          sweeps += 1;
        } catch (error) {
          // A sweep that cannot complete is logged and retried on the next tick; it must never kill the
          // process, and it must never be silent.
          context.logger.error(`controller sweep failed: ${(error as Error).message.slice(0, 200)}`);
        } finally {
          running = false;
        }
      };
      void sweep();
      const timer = setInterval(() => void sweep(), intervalMs);
      // The disposer is the whole point of a boot hook: without it the interval outlives the runtime and a
      // rolling restart leaves a process that will not come down.
      return () => {
        clearInterval(timer);
      };
    },
  };

  // Bindings (#176, D42). The provider side and the consumer side are separate routes because the question
  // asked of each is opposite: "what do I depend on" versus "what breaks if I go away".
  const bindings: ExtensionDescriptor = {
    id: 'bindings',
    requires: ['store', 'identity'],
    routes: [
      {
        method: 'GET', path: '/api/v1/capabilities', operationId: 'listAvailableCapabilities',
        handle: async (request, _params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const resolved = await context.store.resolvePerson({ issuer: auth.claims.issuer, subject: auth.claims.subject });
          if (resolved.ok === false) return { status: 503, body: { error: 'principal-unresolved', message: reasonOf(resolved) } };
          const teams = await context.store.teamsForPerson(resolved.value.person.id);
          const wanted = request.query.get('capability') ?? undefined;
          const perTeam = await Promise.all(teams.map((teamId) => context.store.availableOffersForTeam(teamId, wanted)));
          const seen = new Map<string, CapabilityOffer>();
          for (const offer of perTeam.flat()) seen.set(`${offer.instanceId}/${offer.capability}`, offer);
          return send('listAvailableCapabilities', 200, [...seen.values()]);
        },
      },
      scoped('POST', '/api/v1/instances/{instanceId}/capability', 'publishCapability', 'capability.publish', async (scope, request, params) => {
        const parsed = bodyOf<{ capability?: unknown; outputs?: unknown }>(request);
        if (parsed.ok === false) return badRequest(parsed.error);
        const capability = parsed.value?.capability;
        if (typeof capability !== 'string' || capability.length === 0) return badRequest('capability is required');
        const outputs = Array.isArray(parsed.value?.outputs) ? parsed.value.outputs : [];
        const published = await scope.context.store.publishCapability({ instanceId: params.instanceId ?? '', teamId: scope.teamId, capability, outputs: outputs as CapabilityOffer['outputs'] });
        if (published.ok === false) return { status: published.code === 'not-found' ? 404 : 400, body: { error: published.code, message: reasonOf(published) } };
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'capability.publish', target: params.instanceId ?? '', detail: { capability } });
        return send('publishCapability', 200, published.value);
      }),
      scoped('PUT', '/api/v1/instances/{instanceId}/capability/{capability}/shares', 'shareCapability', 'capability.share', async (scope, request, params) => {
        const parsed = bodyOf<{ toTeamId?: unknown }>(request);
        if (parsed.ok === false) return badRequest(parsed.error);
        const toTeamId = parsed.value?.toTeamId;
        if (typeof toTeamId !== 'string' || toTeamId.length === 0) return badRequest('toTeamId is required (a team id, or * for every team)');
        const shared = await scope.context.store.shareCapability({ instanceId: params.instanceId ?? '', capability: params.capability ?? '', toTeamId, sharedBy: scope.claims.subject });
        if (shared.ok === false) return { status: shared.code === 'not-found' ? 404 : 400, body: { error: shared.code, message: reasonOf(shared) } };
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'capability.share', target: params.instanceId ?? '', detail: { capability: params.capability ?? '', toTeamId } });
        return send('shareCapability', 200, shared.value);
      }),
      scoped('DELETE', '/api/v1/instances/{instanceId}/capability/{capability}/shares/{toTeamId}', 'revokeCapabilityShare', 'capability.share', async (scope, _request, params) => {
        // The team is in the path, not a body: the transport does not read DELETE bodies, and a revoke that
        // cannot say which share it means is a foot-gun rather than a convenience.
        const toTeamId = params.toTeamId;
        if (typeof toTeamId !== 'string' || toTeamId.length === 0) return badRequest('toTeamId is required to revoke one specific share');
        const revoked = await scope.context.store.revokeCapabilityShare(params.instanceId ?? '', params.capability ?? '', toTeamId);
        if (revoked.ok === false) return { status: revoked.code === 'not-found' ? 404 : 400, body: { error: revoked.code, message: reasonOf(revoked) } };
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'capability.revoke', target: params.instanceId ?? '', detail: { capability: params.capability ?? '', toTeamId } });
        return send('revokeCapabilityShare', 200, { revoked: true });
      }),
      scoped('GET', '/api/v1/instances/{instanceId}/bindings', 'listBindings', 'instance.read', async (scope, _request, params) => {
        return send('listBindings', 200, await scope.context.store.listBindings(params.instanceId ?? ''));
      }),
      scoped('PUT', '/api/v1/instances/{instanceId}/bindings/{capability}', 'bindCapability', 'capability.bind', async (scope, request, params) => {
        const parsed = bodyOf<{ providerInstanceId?: unknown; destinations?: unknown }>(request);
        if (parsed.ok === false) return badRequest(parsed.error);
        const providerInstanceId = parsed.value?.providerInstanceId;
        if (typeof providerInstanceId !== 'string' || providerInstanceId.length === 0) return badRequest('providerInstanceId is required');
        const consumer = await scope.context.store.getInstance(params.instanceId ?? '');
        if (consumer.ok === false) return notFound('instance', params.instanceId ?? '');
        const provider = await scope.context.store.getInstance(providerInstanceId);
        if (provider.ok === false) return notFound('instance', providerInstanceId);
        const capability = params.capability ?? '';
        const offer = await scope.context.store.getCapabilityOffer(providerInstanceId, capability);
        const destinations = Array.isArray(parsed.value?.destinations) ? parsed.value.destinations as BindingRecord['destinations'] : [];
        // Policy before write, and the same function the stores are tested with: a binding that cannot fill
        // every destination the consumer declares is a broken promise, not a partial success.
        const verdict = checkBindingPolicy({
          consumer: consumer.value, provider: provider.value, offer: offer.ok ? offer.value : null,
          required: destinations.map((d: { output: string; into: string[] }) => ({ output: d.output, into: d.into })),
          shares: await scope.context.store.listCapabilityShares(providerInstanceId, capability),
        });
        if (verdict.ok === false) return { status: verdict.error.code === 'not-found' ? 404 : 400, body: { error: verdict.error.code, message: reasonOf(verdict.error) } };
        const bound = await scope.context.store.bindCapability({ consumerInstanceId: consumer.value.id, capability, providerInstanceId, destinations, boundBy: scope.claims.subject });
        if (bound.ok === false) return { status: 400, body: { error: bound.code, message: reasonOf(bound) } };
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'capability.bind', target: consumer.value.id, detail: { capability, providerInstanceId } });
        return send('bindCapability', 200, bound.value);
      }),
      scoped('DELETE', '/api/v1/instances/{instanceId}/bindings/{capability}', 'unbindCapability', 'capability.bind', async (scope, _request, params) => {
        const removed = await scope.context.store.unbindCapability(params.instanceId ?? '', params.capability ?? '');
        if (removed.ok === false) return { status: removed.code === 'not-found' ? 404 : 400, body: { error: removed.code, message: reasonOf(removed) } };
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'capability.unbind', target: params.instanceId ?? '', detail: { capability: params.capability ?? '' } });
        return { status: 204, body: undefined };
      }),
      scoped('GET', '/api/v1/instances/{instanceId}/consumers', 'listConsumers', 'instance.read', async (scope, _request, params) => {
        // The deletion-guard answer (D43): refuse a destroy while this is non-empty.
        return send('listConsumers', 200, await scope.context.store.listConsumers(params.instanceId ?? ''));
      }),
    ],
  };

  // Invitations (#186, D44/D46). Two clusters of routes on purpose: the team-scoped ones are what an owner
  // manages, and the `/me` ones are what an outsider can reach before they are a member of anything. They are
  // not the same authorization question and do not share a guard.
  const invitations: ExtensionDescriptor = {
    id: 'invitations',
    requires: ['store', 'identity', 'email'],
    routes: [
      scoped('GET', '/api/v1/teams/{teamId}/invitations', 'listInvitations', 'invitation.list', async (scope, _request, params) => {
        return send('listInvitations', 200, await scope.context.store.listInvitations(params.teamId ?? ''));
      }),
      scoped('POST', '/api/v1/teams/{teamId}/invitations', 'createInvitation', 'team.invite', async (scope, request, params) => {
        const parsed = bodyOf<{ email?: unknown; role?: unknown; ttlDays?: unknown }>(request);
        if (parsed.ok === false) return badRequest(parsed.error);
        const email = parsed.value?.email;
        if (typeof email !== 'string' || email.trim().length === 0) return badRequest('email is required');
        const role = parsed.value?.role === 'owner' ? 'owner' : 'member';
        const ttlDays = typeof parsed.value?.ttlDays === 'number' ? parsed.value.ttlDays : undefined;
        const created = await scope.context.store.createInvitation({ teamId: params.teamId ?? '', email, role, invitedBy: scope.personId, ...(ttlDays === undefined ? {} : { ttlDays }) });
        if (created.ok === false) {
          const status = created.code === 'not-found' ? 404 : created.code === 'conflict' ? 409 : 400;
          return { status, body: { error: created.code, message: reasonOf(created) } };
        }
        const invitation = created.value;
        // Send, then record what the transport said. An unconfigured sender is reported, not hidden: the
        // invitation exists, and the operator needs to know the mail did not go out.
        let delivery: { sent: boolean; reason?: string };
        if (scope.context.email.driver === 'none') {
          // Not an error and not a success: the record exists, the mail did not leave, and both facts are on
          // the row. Refusing the whole request here would make "we never got it" unanswerable.
          const reason = 'no email transport is configured on this control plane';
          delivery = { sent: false, reason };
          await scope.context.store.setInvitationEmailResult(invitation.id, { error: reason });
        } else {
          const link = 'the address your inviter gave you, then open the team page';
          const result = await scope.context.email.send({
            to: [invitation.email],
            subject: `You have been invited to a platfolio team`,
            text: `You have been invited to join a platfolio team as ${invitation.role}.\n\nTo accept: sign in at ${link}.\nThis invitation expires on ${invitation.expiresAt}.\nThe invitation is tied to this address as your identity provider asserts it, so forwarding this email grants nothing to whoever receives it.`,
            correlationId: invitation.id,
          });
          if (result.accepted) {
            delivery = { sent: true };
            await scope.context.store.setInvitationEmailResult(invitation.id, { receipt: result.providerId ?? result.messageId });
          } else {
            delivery = { sent: false, reason: result.reason };
            await scope.context.store.setInvitationEmailResult(invitation.id, { error: result.reason });
          }
        }
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'invitation.create', target: invitation.id, detail: { teamId: invitation.teamId, email: invitation.email, role: invitation.role, sent: delivery.sent } });
        // Re-read rather than echo the row we built before the delivery result was recorded: the response and
        // the record must be the same fact, or a client showing `emailError` from the list would disagree with
        // what it got from the create.
        const stored = await scope.context.store.getInvitation(invitation.id);
        return send('createInvitation', 201, { invitation: stored.ok ? stored.value : invitation, delivery });
      }),
      scoped('DELETE', '/api/v1/teams/{teamId}/invitations/{invitationId}', 'revokeInvitation', 'invitation.revoke', async (scope, _request, params) => {
        const existing = await scope.context.store.getInvitation(params.invitationId ?? '');
        if (existing.ok === false) return notFound('invitation', params.invitationId ?? '');
        // Reading it is one question (is it this team's?), withdrawing it another. A pending invitation from
        // another team must be indistinguishable from one that does not exist.
        if (existing.value.teamId !== (params.teamId ?? '')) return notFound('invitation', params.invitationId ?? '');
        const revoked = await scope.context.store.revokeInvitation(params.invitationId ?? '');
        if (revoked.ok === false) return { status: revoked.code === 'conflict' ? 409 : 400, body: { error: revoked.code, message: reasonOf(revoked) } };
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.personId, action: 'invitation.revoke', target: revoked.value.id, detail: { teamId: revoked.value.teamId } });
        return { status: 204, body: undefined };
      }),
      {
        method: 'GET', path: '/api/v1/me/invitations', operationId: 'listMyInvitations',
        handle: async (request, _params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const email = auth.claims.email;
          const verified = auth.claims.emailVerified;
          if (email === undefined || verified !== true) {
            // Not an empty list: "nobody invited you" and "your identity asserts no address, so nothing can
            // match you" are different answers, and only one of them is actionable.
            return { status: 409, body: { error: 'conflict', message: 'your identity does not assert a verified email address, so there is nothing here to match an invitation against' } };
          }
          const mine = await context.store.findInvitationsForEmail(email);
          return send('listMyInvitations', 200, mine.filter((i) => i.state === 'pending'));
        },
      },
      {
        method: 'POST', path: '/api/v1/me/invitations/{invitationId}/accept', operationId: 'acceptInvitation',
        handle: async (request, params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const found = await context.store.findInvitationsForEmail(auth.claims.email ?? '');
          const invitation = found.find((i) => i.id === params.invitationId) ?? null;
          const verdict = checkInvitationAcceptance({
            invitation,
            // The address is the IdP's assertion, never a body field. A caller that could name its own address
            // could claim any invitation it had merely learned the id of.
            callerEmail: auth.claims.email,
            callerEmailVerified: auth.claims.emailVerified,
            now: new Date().toISOString(),
          });
          if (verdict.ok === false || invitation === null) {
            // `invitation === null` is unreachable when the verdict is ok -- the policy refuses a null
            // invitation -- but the type cannot see that, and a non-null assertion here would be me telling the
            // compiler to trust me rather than showing it.
            if (verdict.ok === false) return { status: verdict.error.code === 'not-found' ? 404 : 409, body: { error: verdict.error.code, message: reasonOf(verdict.error) } };
            return notFound('invitation', params.invitationId ?? '');
          }
          const resolved = await context.store.resolvePerson({ issuer: auth.claims.issuer, subject: auth.claims.subject });
          if (resolved.ok === false) return { status: 503, body: { error: 'principal-unresolved', message: reasonOf(resolved) } };
          const accepted = await context.store.acceptInvitation(invitation.id, resolved.value.person.id);
          if (accepted.ok === false) return { status: accepted.code === 'not-found' ? 404 : 409, body: { error: accepted.code, message: reasonOf(accepted) } };
          await context.store.appendAudit({ actorKind: 'user', actorRef: resolved.value.person.id, action: 'invitation.accept', target: accepted.value.invitation.id, detail: { teamId: accepted.value.member.teamId, role: accepted.value.member.role } });
          return send('acceptInvitation', 200, { teamId: accepted.value.member.teamId, role: accepted.value.member.role, personId: accepted.value.member.personId });
        },
      },
    ],
  };

  // Teams (#195, D44). These are not team-scoped routes -- there is no team to scope to yet. Creation is
  // guarded by authentication plus the verified person, and the caller becomes the owner in the same
  // operation, because a team nobody owns cannot invite, share, or destroy anything and has no way out of that.
  const teams: ExtensionDescriptor = {
    id: 'teams',
    requires: ['store', 'identity'],
    routes: [
      {
        method: 'GET', path: '/api/v1/teams', operationId: 'listTeams',
        handle: async (request, _params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const resolved = await context.store.resolvePerson({ issuer: auth.claims.issuer, subject: auth.claims.subject });
          if (resolved.ok === false) return { status: 503, body: { error: 'principal-unresolved', message: reasonOf(resolved) } };
          const teamIds = await context.store.teamsForPerson(resolved.value.person.id);
          const rows: Array<{ teamId: string; name: string; role: 'owner' | 'member' }> = [];
          // Read from membership, never from a `teamId` the caller supplied: that would be the client
          // asserting its own scope, which is the thing #173 moved out of handlers entirely.
          for (const teamId of teamIds) {
            const [team, member] = await Promise.all([context.store.getTeam(teamId), context.store.getTeamMember(teamId, resolved.value.person.id)]);
            if (team.ok && member.ok) rows.push({ teamId, name: team.value.name, role: member.value.role });
          }
          return send('listTeams', 200, rows);
        },
      },
      {
        method: 'POST', path: '/api/v1/teams', operationId: 'createTeam',
        handle: async (request, _params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const parsed = bodyOf<{ name?: unknown }>(request);
          if (parsed.ok === false) return badRequest(parsed.error);
          if (typeof parsed.value?.name !== 'string' || parsed.value.name.trim().length === 0) return badRequest('name is required');
          const resolved = await context.store.resolvePerson({ issuer: auth.claims.issuer, subject: auth.claims.subject });
          if (resolved.ok === false) return { status: 503, body: { error: 'principal-unresolved', message: reasonOf(resolved) } };
          const personId = resolved.value.person.id;
          // Normalised here so the 409 message names the address the caller will actually type, and refused by
          // the schema if it is not a slug at all: `team/name` is a URL segment (D45).
          const name = normaliseName(parsed.value.name);
          const created = await context.store.createTeam({ name });
          if (created.ok === false) {
            const status = created.code === 'conflict' && reasonOf(created).includes('already exists') ? 409 : 400;
            return { status, body: { error: created.code, message: reasonOf(created) } };
          }
          const member = await context.store.putTeamMember({ teamId: created.value.id, personId, role: 'owner' });
          if (member.ok === false) {
            // Reported, not papered over -- and no rollback. The first version of this branch called a
            // `deleteTeam` method I had invented for the purpose, which the seam does not have and does not
            // need: a half-applied team is unrecoverable only in theory, because both rows were just read
            // back as existing (the person was resolved above, the team was inserted here). Adding a deletion
            // capability to erase a state that requires the database to have lost a row it just accepted would
            // be a new API for a bug in someone else's transaction -- and dead code the moment it is unwired.
            // If this ever does fire, the operator hears about it through the audit trail and a 503.
            await context.store.appendAudit({ actorKind: 'system', actorRef: 'teams', action: 'team.ownership-failed', target: created.value.id, detail: { personId, reason: reasonOf(member) } });
            return { status: 503, body: { error: member.code, message: `team created but ownership failed: ${reasonOf(member)}` } };
          }
          await context.store.appendAudit({ actorKind: 'user', actorRef: personId, action: 'team.create', target: created.value.id, detail: { name } });
          return send('createTeam', 201, { teamId: created.value.id, name: created.value.name, role: 'owner' });
        },
      },
    ],
  };

  return [core, instances, dispatches, audit, teams, bindings, invitations, controller];
}

export type { VerifiedClaims };
