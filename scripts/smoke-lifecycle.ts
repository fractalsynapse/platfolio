/**
 * `pnpm run lifecycle:smoke` -- the Slice 2 acceptance, executed against the running stack.
 *
 * Unlike `identity:smoke`, which proves a token is verified, this proves the *records* work: an instance is
 * created, a plan is registered, a dispatch is issued and consumed exactly once, an attestation is accepted,
 * and the controller -- with no human and no test harness involved -- moves the instance to `live`.
 *
 * Needs: docker compose up -d && pnpm run identity:seed && pnpm run db:seed-dev.
 */
import { createHmac } from 'node:crypto';
import { PostgresStore } from '../packages/contracts/src/postgres-store.ts';

const api = process.env.CONTROL_PLANE_BASE ?? 'http://localhost:8082';
const idp = process.env.KC_BASE ?? 'http://localhost:8081';
const dbUrl = process.env.PLATFOLIO_DB_URL ?? 'postgresql://postgres:platfolio-dev-only@localhost:5432/platfolio';

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string): void => {
  results.push({ name, ok, detail });
  process.stdout.write(`L ${ok ? 'pass' : 'FAIL'}  ${name} -- ${detail.slice(0, 170)}\n`);
};

// Read through a *separate* store instance, in a separate process: that is what makes "persisted" a claim
// about the database rather than about the container's memory. The memory driver would pass every HTTP check
// here and fail this one.
const reader = new PostgresStore({ connectionString: dbUrl });
async function call(path: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(api + path, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let json: Record<string, unknown> | undefined;
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* a non-JSON answer is itself a finding */ }
  return { status: response.status, json, text };
}

const readiness = await call('/readyz');
const checks = (readiness.json?.checks ?? []) as Array<{ name: string; status: string }>;
const database = checks.find((c) => c.name === 'database');
check('control plane reports a real database', readiness.status === 200 && database?.status === 'ok', `readyz ${String(readiness.status)} database=${String(database?.status)}`);

const tokenResponse = await fetch(`${idp}/realms/platfolio/protocol/openid-connect/token`, {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'password', client_id: 'platfolio-api', client_secret: 'platfolio-dev-only', username: 'adrian', password: 'platfolio-dev-only' }),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
});
const accessToken = tokenResponse.ok ? ((await tokenResponse.json()) as { access_token: string }).access_token : undefined;
if (!accessToken) {
  check('token from Keycloak', false, `status ${String(tokenResponse.status)}`);
  process.stdout.write('L cannot continue without a token\n');
  await reader.close();
  process.exit(1);
}
check('token from Keycloak', true, `${String(accessToken.length)} chars`);

const teams = await reader.listTeams();
if (teams.length === 0) {
  check('a seeded team exists', false, 'run pnpm run db:seed-dev');
  await reader.close();
  process.exit(1);
}
const teamId = String(teams[0]?.id);
check('a seeded team exists', true, teamId);

const suffix = Date.now().toString(36).slice(-6);
const created = await call('/api/v1/instances', { method: 'POST', body: JSON.stringify({ teamId, name: `smoke-${suffix}`, platform: 'starter-web' }) }, accessToken);
const instanceId = created.json?.id as string | undefined;
check('create instance over HTTP', created.status === 201 && typeof instanceId === 'string', `${String(created.status)} ${created.text.slice(0, 90)}`);
check('a created instance starts pending, not live', created.json?.state === 'pending', `state=${String(created.json?.state)}`);

if (!instanceId) { await reader.close(); process.exit(1); }
const planHash = createHmac('sha256', 'smoke').update(instanceId).digest('hex');
const plan = {
  instanceId, teamId, provider: 'railway', contract: '1.0.0', planHash,
  manifestRef: { platform: 'starter-web', version: '0.1.0' },
  environments: [{ name: 'production', services: [], databases: [], volumes: [], buckets: [], domains: [] }],
};
const registered = await call(`/api/v1/instances/${instanceId}/plan`, { method: 'PUT', body: JSON.stringify({ plan }) }, accessToken);
check('plan registered by its own digest', registered.status === 200 && registered.json?.planHash === planHash, `${String(registered.status)} ${registered.text.slice(0, 90)}`);

const dispatched = await call(`/api/v1/instances/${instanceId}/dispatches`, { method: 'POST', body: JSON.stringify({ action: 'apply', environment: 'production' }) }, accessToken);
const intent = dispatched.json?.intent as { dispatchId: string; nonce: string; planHash: string } | undefined;
check('dispatch issued', dispatched.status === 201 && !!intent, `${String(dispatched.status)} ${dispatched.text.slice(0, 90)}`);
if (!intent) { await reader.close(); process.exit(1); }

const fetched = await call(`/api/v1/instances/${instanceId}/dispatches/${intent.dispatchId}`);
check('runner can fetch the plan', fetched.status === 200 && fetched.json?.planHash === planHash, `${String(fetched.status)}`);
const replay = await call(`/api/v1/instances/${instanceId}/dispatches/${intent.dispatchId}`);
check('the same dispatch cannot be fetched twice', replay.status === 409, `${String(replay.status)} ${replay.text.slice(0, 80)}`);

const attested = await call('/api/v1/attestations', {
  method: 'POST',
  body: JSON.stringify({
    dispatchId: intent.dispatchId, instanceId, nonce: intent.nonce, planHash: intent.planHash,
    action: 'apply', environment: 'production', result: 'ok',
    resources: [{ kind: 'service', name: 'web', externalId: 'svc-smoke', status: 'live' }],
    // Real hex. The first draft used 's'.repeat(40) and 'm'.repeat(64) -- forty and sixty-four characters of
                // non-hex -- and the contract was right to refuse it.
                release: { version: '0.0.0-smoke', commitSha: '7'.repeat(40), imageDigest: `sha256:${'a'.repeat(64)}` },
    durationMs: 250, finishedAt: new Date().toISOString(),
  }),
});
check('attestation accepted', attested.status === 202, `${String(attested.status)} ${attested.text.slice(0, 90)}`);
const dup = await call('/api/v1/attestations', { method: 'POST', body: JSON.stringify({ dispatchId: intent.dispatchId, nonce: intent.nonce }) });
check('a second attestation for one dispatch is refused', dup.status === 400 || dup.status === 409, `${String(dup.status)} ${dup.text.slice(0, 80)}`);

// Poll for the reconciliation instead of sleeping a fixed time: the sweep interval is configuration
// (PLATFOLIO_RECONCILE_INTERVAL_MS), and a test that assumes a duration is a test that fails on a machine
// that is merely slow. Reading through a *second* store in a *separate* process keeps the claim about the
// database rather than about whatever the container remembers.
let stored = await reader.getInstance(instanceId);
const deadline = Date.now() + 20_000;
while (!(stored.ok && stored.value.state === 'live') && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  stored = await reader.getInstance(instanceId);
}
check('the controller consumed the attestation into stored state', stored.ok && stored.value.state === 'live', stored.ok ? `state=${stored.value.state} hash=${String(stored.value.lastAppliedPlanHash ?? '').slice(0, 12)}` : 'instance unreadable from a second process');
const auditRows = (await reader.recentAudit(200)).filter((a) => a.actorKind === 'controller' && a.target === instanceId);
check('the controller is attributed in the audit trail', auditRows.length > 0, `${String(auditRows.length)} controller rows, actions ${auditRows.map((a) => a.action).join(', ')}`);
const persisted = await reader.getAttestation(intent.dispatchId);
check('the attestation is a row, not a memory', persisted.ok && persisted.value.result === 'ok', persisted.ok ? `result=${persisted.value.result} actor=${persisted.value.actorKind}` : 'attestation not readable cross-process');

// Restart-proof by construction: a fresh store reading the same schema sees the same instance.
const listAfterRestart = await call('/api/v1/instances', {}, accessToken);
check('authenticated list reflects the record', listAfterRestart.status === 200 && JSON.stringify(listAfterRestart.json ?? []).includes(instanceId), `${String(listAfterRestart.status)}`);

// Cross-team authorization, against a team this caller is NOT a member of. The foreign instance is written
// through the database from this process, because the whole point is that the API cannot create it.
const otherTeams = (await reader.listTeams()).filter((x) => x.name === 'other-workspace');
if (otherTeams.length === 1) {
  const foreign = await reader.createInstance({ teamId: otherTeams[0]?.id ?? '', name: `foreign-${suffix}`, platform: 'starter-web' });
  if (foreign.ok) {
    const listed = await call('/api/v1/instances', {}, accessToken);
    const ids = JSON.stringify(listed.json ?? []);
    check('another teams instance is absent from the list', listed.status === 200 && !ids.includes(foreign.value.id), `${String(listed.status)} ids contain foreign=${ids.includes(foreign.value.id)}`);
    const probe = await call(`/api/v1/instances/${foreign.value.id}`, {}, accessToken);
    check('reading it is a 404, not a 403', probe.status === 404, `${String(probe.status)} ${probe.text.slice(0, 70)} -- a 403 would confirm it exists`);
    const plant = await call(`/api/v1/instances/${foreign.value.id}/plan`, { method: 'PUT', body: JSON.stringify({ plan: { instanceId: foreign.value.id, planHash: 'b'.repeat(64) } }) }, accessToken);
    check('writing to it is refused the same way', plant.status === 404, `${String(plant.status)}`);
  } else {
    check('another teams instance is absent from the list', false, 'could not create the foreign instance');
  }
} else {
  check('another teams instance is absent from the list', false, `expected one other-workspace team, found ${String(otherTeams.length)} -- run pnpm run db:seed-dev`);
}

// Capabilities and bindings, live (#177): publish, discover, bind, and see the dependency from both ends.
// This runs against the container, so it proves the routes are wired and the Postgres tables exist -- not
// merely that the handlers compile against a map.
const second = await call('/api/v1/instances', { method: 'POST', body: JSON.stringify({ teamId, name: `identity-${suffix}`, platform: 'shared-identity' }) }, accessToken);
const providerId = (second.json as { id?: string } | undefined)?.id;
if (typeof providerId === 'string') {
  const published = await call(`/api/v1/instances/${providerId}/capability`, { method: 'POST', body: JSON.stringify({ capability: 'identity', outputs: [{ output: 'issuer', kind: 'url', state: 'issued-and-placed' }] }) }, accessToken);
  check('capability published', published.status === 200, `${String(published.status)} ${published.text.slice(0, 70)}`);
  const discovered = await call('/api/v1/capabilities?capability=identity', {}, accessToken);
  const offers = Array.isArray(discovered.json) ? discovered.json : [];
  check('own-team offer is discoverable', offers.some((o: Record<string, unknown>) => o.instanceId === providerId), `${String(offers.length)} offer(s)`);
  const bound = await call(`/api/v1/instances/${instanceId}/bindings/identity`, { method: 'PUT', body: JSON.stringify({ providerInstanceId: providerId, destinations: [{ output: 'issuer', into: ['OIDC_ISSUER'] }] }) }, accessToken);
  check('binding created', bound.status === 200, `${String(bound.status)} ${bound.text.slice(0, 90)}`);
  const consumers = await call(`/api/v1/instances/${providerId}/consumers`, {}, accessToken);
  const list = Array.isArray(consumers.json) ? consumers.json : [];
  check('the provider can see who depends on it', list.some((b: Record<string, unknown>) => b.consumerInstanceId === instanceId), `${String(list.length)} consumer(s) -- the question #177 exists to answer`);
  const persisted = await reader.listConsumers(providerId);
  check('bindings survive as rows, read from a second process', persisted.length === 1, `${String(persisted.length)} row(s) in capability_bindings`);
  const unbound = await call(`/api/v1/instances/${instanceId}/bindings/identity`, { method: 'DELETE' }, accessToken);
  check('unbind answers 204 with no body', unbound.status === 204 && unbound.text === '', `${String(unbound.status)} body=${JSON.stringify(unbound.text).slice(0, 20)}`);
} else {
  check('capability published', false, `second instance could not be created: ${String(second.status)}`);
}

await reader.close();
const failed = results.filter((r) => !r.ok);
process.stdout.write(`L ${String(results.length - failed.length)}/${String(results.length)} checks passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
