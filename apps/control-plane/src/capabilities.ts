import { randomBytes } from 'node:crypto';
import {
  AttestationSchema, CONTRACT_NAME, CONTRACT_VERSION, DispatchIntentSchema, InstanceSchema,
  reasonOf, type VerifiedClaims,
} from '@platfolio/contracts';
import type { ExtensionDescriptor, KernelContext, Request, Response_ } from '@platfolio/kernel';
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
    // Every capability that calls `authorize` must declare `identity` as well as `store`: Cordis checks access
    // against the fiber's own inject list, so an undeclared dependency throws on the first request rather than
    // at composition time. That refusal is correct and my descriptors were the bug -- measured, not theorised.
    id: 'instances',
    requires: ['store', 'identity'],
    routes: [
      {
        method: 'GET', path: '/api/v1/instances', operationId: 'listInstances',
        handle: async (request, _params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          return send('listInstances', 200, await context.store.listInstances());
        },
      },
      {
        method: 'POST', path: '/api/v1/instances', operationId: 'createInstance',
        handle: async (request, _params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const parsed = bodyOf<{ teamId?: string; name?: string; platform?: string }>(request);
          if (parsed.ok === false) return badRequest(parsed.error);
          const input = InstanceSchema.pick({ teamId: true, name: true, platform: true }).safeParse(parsed.value ?? {});
          if (!input.success) return badRequest(input.error.issues.map((i) => `${i.path.join('.') || '<root>'} ${i.message}`).join('; '));
          const created = await context.store.createInstance(input.data);
          if (created.ok === false) return { status: 400, body: { error: created.code, message: reasonOf(created) } };
          await context.store.appendAudit({ actorKind: 'user', actorRef: auth.claims.subject, action: 'instance.create', target: created.value.id, detail: { platform: created.value.platform } });
          // A 201 here records intent. Nothing about provisioning is claimed, because nothing was verified
          // (D30 law 1): the state says `pending` and only the controller moves it.
          return send('createInstance', 201, created.value);
        },
      },
      {
        method: 'GET', path: '/api/v1/instances/{instanceId}', operationId: 'getInstance',
        handle: async (request, params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const found = await context.store.getInstance(params.instanceId ?? '');
          return found.ok ? send('getInstance', 200, found.value) : notFound('instance', params.instanceId ?? '');
        },
      },
      {
        method: 'PUT', path: '/api/v1/instances/{instanceId}/plan', operationId: 'putPlan',
        handle: async (request, params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const parsed = bodyOf<{ plan?: unknown }>(request);
          if (parsed.ok === false) return badRequest(parsed.error);
          const plan = parsed.value?.plan;
          if (!plan || typeof plan !== 'object') return badRequest('body must be { plan: object }');
          const hash = (plan as { planHash?: unknown }).planHash;
          if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
            // The hash on the plan is authoritative. Re-deriving one here would recreate the bug that made
            // every honest attestation fail with 400: two implementations of a digest that has one home.
            return badRequest(`plan must carry a bare 64-hex planHash computed by buildPlan, got ${typeof hash === 'string' ? hash.slice(0, 24) : String(hash)}`);
          }
          const stored = await context.store.putPlan(params.instanceId ?? '', plan, hash);
          if (stored.ok === false) return { status: stored.code === 'not-found' ? 404 : 400, body: { error: stored.code, message: reasonOf(stored) } };
          await context.store.updateInstanceState(params.instanceId ?? '', 'pending', { desiredPlanHash: hash });
          await context.store.appendAudit({ actorKind: 'user', actorRef: auth.claims.subject, action: 'plan.register', target: params.instanceId ?? '', detail: { planHash: hash.slice(0, 12) } });
          return send('putPlan', 200, { instanceId: params.instanceId ?? '', planHash: hash });
        },
      },
    ],
  };

  const dispatches: ExtensionDescriptor = {
    id: 'dispatches',
    requires: ['store', 'identity'],
    routes: [
      {
        method: 'POST', path: '/api/v1/instances/{instanceId}/dispatches', operationId: 'createDispatch',
        handle: async (request, params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const instanceId = params.instanceId ?? '';
          const plan = await context.store.getPlan(instanceId);
          if (plan.ok === false) return notFound('plan', instanceId);
          const parsed = bodyOf<{ action?: 'apply' | 'destroy'; environment?: string }>(request);
          if (parsed.ok === false) return badRequest(parsed.error);
          const action = parsed.value?.action ?? 'apply';
          const environment = parsed.value?.environment ?? 'production';
          const issued = now();
          const ttl = deps.dispatchTtlMs ?? 15 * 60_000;
          // The dispatch copies the plan at issue time. A runner that fetches after the desired state moved
          // must not be authorised for the new plan -- the hash it attests against would no longer mean
          // anything.
          const created = await context.store.createDispatch({
            instanceId,
            nonce: randomBytes(16).toString('hex'),
            planHash: plan.value.planHash,
            action,
            environment,
            issuedAt: issued.toISOString(),
            expiresAt: new Date(issued.getTime() + ttl).toISOString(),
            plan: plan.value.plan,
          });
          if (created.ok === false) return { status: 400, body: { error: created.code, message: reasonOf(created) } };
          const intent = DispatchIntentSchema.parse({
            instanceId, teamId: (await context.store.getInstance(instanceId)).ok ? ((await context.store.getInstance(instanceId)) as { value: { teamId: string } }).value.teamId : 'unknown',
            dispatchId: created.value.id, nonce: created.value.nonce, planHash: created.value.planHash,
            action, environment, issuedAt: created.value.issuedAt, expiresAt: created.value.expiresAt,
          });
          await context.store.appendAudit({ actorKind: 'user', actorRef: auth.claims.subject, action: 'dispatch.create', target: created.value.id, detail: { instanceId, action, environment } });
          return send('createDispatch', 201, { intent });
        },
      },
      {
        method: 'GET', path: '/api/v1/instances/{instanceId}/dispatches/{dispatchId}', operationId: 'getDispatchPlan',
        handle: async (_request, params, context) => {
          // The runner authenticates with the shared dispatch secret, not a user token: whoami-style scope
          // checks here would reject the very job the platform exists to start. Identity of the runner is the
          // #159 gap; the single-use nonce is what bounds the damage meanwhile.
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
      {
        method: 'GET', path: '/api/v1/instances/{instanceId}/latest-attestation', operationId: 'getLatestAttestation',
        handle: async (request, params, context) => {
          const auth = await authorize(context, request);
          if (auth.ok === false) return auth.response;
          const latest = await context.store.latestAttestation(params.instanceId ?? '');
          return latest.ok ? send('getLatestAttestation', 200, latest.value) : notFound('attestation', params.instanceId ?? '');
        },
      },
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
        return send('listAudit', 200, await context.store.recentAudit(limit));
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
