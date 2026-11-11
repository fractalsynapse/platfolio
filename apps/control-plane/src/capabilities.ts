import { randomBytes } from 'node:crypto';
import {
  AttestationSchema, CONTRACT_NAME, CONTRACT_VERSION, DispatchIntentSchema, InstanceSchema,
  reasonOf, type VerifiedClaims,
} from '@platfolio/contracts';
import type { ExtensionDescriptor, KernelContext, Request, Response_, RouteDefinition } from '@platfolio/kernel';
import { badRequest, bearerToken, notFound, send, unauthorized, type Authorizer } from './respond.ts';

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

type Scope = { context: KernelContext; claims: VerifiedClaims; teamId: string };
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
async function resolveScope(context: KernelContext, request: Request, params: Record<string, string>, viaTeamId?: string): Promise<{ ok: true; scope: Scope } | { ok: false; response: Response_ }> {
  const auth = await authorize(context, request);
  if (auth.ok === false) return { ok: false, response: auth.response };
  const subject = auth.claims.subject;
  const teams = await context.store.teamsForSubject(subject);
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
  if (!teams.includes(teamId)) {
    // Same 404 whether the resource exists or not, so the answer cannot be probed for membership.
    return { ok: false, response: { status: 404, body: { error: 'not-found', message: 'no such resource for this principal' } } };
  }
  return { ok: true, scope: { context, claims: auth.claims, teamId } };
}

/** Wraps a handler so the scope is resolved before it runs. Team-scoped routes are built with this only. */
function scoped(method: string, path: string, operationId: string, handler: ScopedHandler): RouteDefinition {
  return {
    method,
    path,
    operationId,
    handle: async (request, params, context) => {
      const resolved = await resolveScope(context, request, params);
      if (resolved.ok === false) return resolved.response;
      return handler(resolved.scope, request, params);
    },
  };
}

export function buildCapabilities(deps: CapabilityDeps): ExtensionDescriptor[] {
  const now = () => nowOf(deps);

  const core: ExtensionDescriptor = {
    id: 'core',
    requires: ['identity', 'store'],
    routes: [
      {
        method: 'GET', path: '/healthz', operationId: 'getHealth',
        handle: async (_request, _params, context) => {
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
    requires: ['store', 'identity'],
    routes: [
      {
        method: 'GET', path: '/api/v1/instances', operationId: 'listInstances',
        handle: async (request, _params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const teams = await context.store.teamsForSubject(auth.claims.subject);
          // Filtered by membership, not by "there is only one team in the demo". An outsider sees an empty
          // list, which is the same answer as a member of an empty team -- no signal about what exists.
          const visible = await Promise.all(teams.map((teamId) => context.store.listInstances(teamId)));
          return send('listInstances', 200, visible.flat());
        },
      },
      {
        method: 'POST', path: '/api/v1/instances', operationId: 'createInstance',
        handle: async (request, params, context) => {
          const parsed = bodyOf<{ teamId?: unknown; name?: unknown; platform?: unknown }>(request);
          if (parsed.ok === false) return badRequest(parsed.error);
          const input = InstanceSchema.pick({ teamId: true, name: true, platform: true }).safeParse(parsed.value ?? {});
          if (!input.success) return badRequest(input.error.issues.map((i) => `${i.path.join('.') || '<root>'} ${i.message}`).join('; '));
          // Membership is checked against the team named in the body, which resolveScope cannot read from
          // params. Passing it explicitly keeps the decision in one place: the caller may act for that team or
          // get the same 404 as if the team did not exist.
          const resolved = await resolveScope(context, request, params, input.data.teamId);
          if (resolved.ok === false) return resolved.response;
          const created = await context.store.createInstance(input.data);
          if (created.ok === false) return { status: 400, body: { error: created.code, message: reasonOf(created) } };
          await context.store.appendAudit({ actorKind: 'user', actorRef: resolved.scope.claims.subject, action: 'instance.create', target: created.value.id, detail: { platform: created.value.platform, teamId: created.value.teamId } });
          // A 201 records intent. Nothing about provisioning is claimed, because nothing was verified
          // (D30 law 1): state stays `pending` and only a reconciled attestation moves it.
          return send('createInstance', 201, created.value);
        },
      },
      scoped('GET', '/api/v1/instances/{instanceId}', 'getInstance', async (scope, _request, params) => {
        const found = await scope.context.store.getInstance(params.instanceId ?? '');
        // resolveScope already proved the instance exists and is the caller's team's; a mismatch here means the
        // row went away mid-request, which is a 404 like any other missing record.
        return found.ok ? send('getInstance', 200, found.value) : notFound('instance', params.instanceId ?? '');
      }),
      scoped('PUT', '/api/v1/instances/{instanceId}/plan', 'putPlan', async (scope, request, params) => {
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
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.claims.subject, action: 'plan.register', target: params.instanceId ?? '', detail: { planHash: hash.slice(0, 12) } });
        return send('putPlan', 200, { instanceId: params.instanceId ?? '', planHash: hash });
      }),
    ],
  };

  const dispatches: ExtensionDescriptor = {
    id: 'dispatches',
    requires: ['store', 'identity'],
    routes: [
      scoped('POST', '/api/v1/instances/{instanceId}/dispatches', 'createDispatch', async (scope, request, params) => {
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
        await scope.context.store.appendAudit({ actorKind: 'user', actorRef: scope.claims.subject, action: 'dispatch.create', target: instanceId, detail: { dispatchId: created.value.id, action, environment } });
        return send('createDispatch', 201, { intent });
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
      scoped('GET', '/api/v1/instances/{instanceId}/latest-attestation', 'getLatestAttestation', async (scope, _request, params) => {
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
        const teams = await context.store.teamsForSubject(auth.claims.subject);
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
            if (next === instance.state && instance.lastAppliedPlanHash === attested.planHash) continue;
            const updated = await context.store.updateInstanceState(instance.id, next, { lastAppliedPlanHash: attested.planHash });
            if (updated.ok) {
              await context.store.appendAudit({ actorKind: 'controller', actorRef: `sweep-${String(sweeps)}`, action: 'instance.state', target: instance.id, detail: { from: instance.state, to: next, dispatchId: attested.dispatchId } });
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

  return [core, instances, dispatches, audit, controller];
}

export type { VerifiedClaims };
