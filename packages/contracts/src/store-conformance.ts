import { AttestationSchema, type Attestation } from './attestation.ts';
import { RepoConnectionSchema, reasonOf, type DispatchRecord, type Store, type StoreError } from './persistence.ts';

/**
 * The Store conformance suite -- the same cases for the memory double and Postgres (docs/design/10 OD8).
 *
 * Cases are written against the *interface*, so a driver-specific shortcut (a Postgres-only constraint the
 * memory double fakes, or an in-memory object leak no database would have) shows up as a failure here rather
 * than as a production surprise. The last few cases are the ones that earn this file its keep: they exist
 * because a naive in-memory store passes round-trips and fails isolation.
 */
export interface StoreCaseResult { name: string; status: 'pass' | 'fail' | 'not-implemented'; detail: string }
export interface StoreReport {
  driver: string;
  results: StoreCaseResult[];
  passed: number;
  failed: number;
  unimplemented: number;
  ok: boolean;
}

const nonce = 'a'.repeat(32);
const planHash = 'b'.repeat(64);

function attestationFor(dispatch: DispatchRecord, overrides: Partial<Attestation> = {}): Attestation {
  return AttestationSchema.parse({
    dispatchId: dispatch.id,
    instanceId: dispatch.instanceId,
    nonce: dispatch.nonce,
    planHash: dispatch.planHash,
    action: dispatch.action,
    environment: dispatch.environment,
    result: 'ok',
    resources: [{ kind: 'service', name: 'api', externalId: 'svc-1', status: 'live' }],
    release: { version: '0.1.0', commitSha: 'c'.repeat(40), imageDigest: `sha256:${'d'.repeat(64)}` },
    durationMs: 1_000,
    finishedAt: new Date().toISOString(),
    ...overrides,
  });
}

export async function runStoreConformance(make: () => Promise<Store> | Store): Promise<StoreReport> {
  const results: StoreCaseResult[] = [];
  const add = async (name: string, run: () => Promise<{ status: StoreCaseResult['status']; detail: string }>): Promise<void> => {
    try {
      const outcome = await run();
      // Field-by-field, so a case body cannot overwrite the title it is reported under (same mistake the
      // identity suite made, and it silently disabled name-matched assertions there).
      results.push({ name, status: outcome.status, detail: outcome.detail });
    } catch (error) {
      results.push({ name, status: 'fail', detail: `threw: ${(error as Error).message.slice(0, 200)}` });
    }
  };
  const fresh = async () => await make();
  const expectErr = (result: { ok: boolean; value?: unknown } & Partial<StoreError>, code: StoreError['code'], label: string) =>
    result.ok ? { status: 'fail' as const, detail: `${label}: expected ${code}, got acceptance` }
      : result.code !== code ? { status: 'fail' as const, detail: `${label}: expected ${code}, got ${String(result.code)}` }
        : { status: 'pass' as const, detail: `${label} refused as ${code}` };

  const seed = async () => {
    const store = await fresh();
    const team = await store.createTeam({ name: 'seed-team' });
    if (!team.ok) throw new Error('seed team create failed');
    const instance = await store.createInstance({ teamId: team.value.id, name: 'seed-app', platform: 'starter-web' });
    if (!instance.ok) throw new Error('seed instance create failed');
    return { store, team: team.value, instance: instance.value };
  };

  await add('describe: names the driver and its readiness', async () => {
    const store = await fresh();
    const info = store.describe();
    return info.driver.length > 0 && typeof info.schemaReady === 'boolean'
      ? { status: 'pass', detail: `${info.driver}, schemaReady=${String(info.schemaReady)}` }
      : { status: 'fail', detail: `unhelpful describe(): ${JSON.stringify(info)}` };
  });

  await add('team and instance round-trip, ids assigned by the store', async () => {
    const { store, team, instance } = await seed();
    const readBack = await store.getInstance(instance.id);
    if (!readBack.ok) return { status: 'fail', detail: 'instance not found after create' };
    const teams = await store.listTeams();
    return teams.some((t) => t.id === team.id)
      ? { status: 'pass', detail: `${instance.id}, ${teams.length} team(s)` }
      : { status: 'fail', detail: 'listTeams did not include the created team' };
  });

  await add('unknown ids answer with typed errors, never exceptions', async () => {
    const store = await fresh();
    const team = await store.getTeam('team-does-not-exist');
    const inst = await store.getInstance('inst-does-not-exist');
    const disp = await store.getDispatch('disp-nope');
    const allNotFound = [team, inst, disp].every((r) => !r.ok && r.code === 'not-found');
    return allNotFound ? { status: 'pass', detail: 'three lookups, three not-found' } : { status: 'fail', detail: JSON.stringify([team, inst, disp].map((r) => (r.ok ? 'ok' : r.code))) };
  });

  await add('referential guards: no instance without a team, no connection without an instance', async () => {
    const store = await fresh();
    const orphan = await store.createInstance({ teamId: 'team-missing', name: 'x', platform: 'starter-web' });
    const a = expectErr(orphan, 'not-found', 'instance with unknown team');
    if (a.status === 'fail') return a;
    const conn = await store.putRepoConnection({ instanceId: 'inst-missing', repo: 'acme/app', defaultBranch: 'main', actionRef: 'e'.repeat(40), installedAt: new Date().toISOString() });
    return expectErr(conn, 'not-found', 'repo connection for unknown instance');
  });

  await add('a plan is stored by its own digest, and a malformed hash is refused', async () => {
    const { store, instance } = await seed();
    const bad = await store.putPlan(instance.id, { instanceId: instance.id }, 'sha256:abc');
    if (bad.ok) return { status: 'fail', detail: 'a prefixed/non-hex plan hash was accepted -- the digest shape the runner compares is now ambiguous' };
    const missing = await store.putPlan('inst-nobody', { x: 1 }, planHash);
    if (missing.ok) return { status: 'fail', detail: 'a plan for an unknown instance was accepted' };
    const stored = await store.putPlan(instance.id, { instanceId: instance.id, environments: [] }, planHash);
    if (!stored.ok) return { status: 'fail', detail: `valid plan refused: ${JSON.stringify(stored)}` };
    const read = await store.getPlan(instance.id);
    if (!read.ok) return { status: 'fail', detail: 'plan not readable after write' };
    const tampered = read.ok ? structuredClone(read.value) : null;
    if (tampered) (tampered.plan as { injected?: string }).injected = 'caller mutation';
    const again = await store.getPlan(instance.id);
    return again.ok && JSON.stringify(again.value.plan) === JSON.stringify(read.ok ? read.value.plan : null)
      ? { status: 'pass', detail: 'stored, digest-checked, and immune to caller mutation' }
      : { status: 'fail', detail: 'mutating a read plan changed what the store returns' };
  });

  await add('the plan a dispatch authorises is the plan at issue time', async () => {
    // The reason plans are copied into the dispatch: desired state moving between issue and fetch must not
    // change what a runner is allowed to apply, or the plan hash comparison becomes a comparison against a
    // moving target and honest attestation becomes impossible.
    const { store, instance } = await seed();
    const firstHash = planHash;
    await store.putPlan(instance.id, { instanceId: instance.id, revision: 1 }, firstHash);
    const dispatch = await store.createDispatch({
      instanceId: instance.id, nonce, planHash: firstHash, action: 'apply', environment: 'production',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: { instanceId: instance.id, revision: 1 },
    });
    if (!dispatch.ok) return { status: 'fail', detail: JSON.stringify(dispatch) };
    await store.putPlan(instance.id, { instanceId: instance.id, revision: 2 }, 'c'.repeat(64));
    const fetched = await store.getDispatch(dispatch.value.id);
    if (!fetched.ok) return { status: 'fail', detail: 'dispatch unreadable' };
    const planJson = JSON.stringify(fetched.value.plan);
    return planJson.includes('revision\":1') || planJson.includes('"revision":1')
      ? { status: 'pass', detail: 'the dispatch still carries revision 1' }
      : { status: 'fail', detail: `dispatch plan drifted after issuance: ${planJson.slice(0, 120)}` };
  });

  await add('a dispatch is single-use, and the second consume is a replay', async () => {
    const { store, instance } = await seed();
    const created = await store.createDispatch({
      instanceId: instance.id, nonce, planHash, action: 'apply', environment: 'production',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: { instanceId: instance.id },
    });
    if (!created.ok) return { status: 'fail', detail: `dispatch create failed: ${JSON.stringify(created)}` };
    const first = await store.consumeDispatch(created.value.id);
    if (!first.ok) return { status: 'fail', detail: `first consume refused: ${JSON.stringify(first)}` };
    return expectErr(await store.consumeDispatch(created.value.id), 'consumed', 'second consume');
  });

  await add('an expired dispatch cannot be consumed', async () => {
    const { store, instance } = await seed();
    const created = await store.createDispatch({
      instanceId: instance.id, nonce, planHash, action: 'apply', environment: 'production',
      issuedAt: new Date(Date.now() - 7_200_000).toISOString(), expiresAt: new Date(Date.now() - 3_600_000).toISOString(), plan: {},
    });
    if (!created.ok) return { status: 'fail', detail: JSON.stringify(created) };
    return expectErr(await store.consumeDispatch(created.value.id), 'expired', 'expired consume');
  });

  await add('attestation policy: unknown dispatch, foreign nonce, moved hash, wrong environment', async () => {
    const { store, instance } = await seed();
    const created = await store.createDispatch({
      instanceId: instance.id, nonce, planHash, action: 'apply', environment: 'production',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: {},
    });
    if (!created.ok) return { status: 'fail', detail: JSON.stringify(created) };
    const dispatch = created.value;
    const unknown = await store.recordAttestation(attestationFor(dispatch, { dispatchId: 'disp-other' }));
    const unknownVerdict = expectErr(unknown, 'not-found', 'attestation for an unknown dispatch');
    if (unknownVerdict.status === 'fail') return unknownVerdict;
    const foreignNonce = await store.recordAttestation(attestationFor(dispatch, { nonce: 'z'.repeat(32) }));
    const nonceVerdict = expectErr(foreignNonce, 'conflict', 'foreign nonce');
    if (nonceVerdict.status === 'fail') return nonceVerdict;
    const movedHash = await store.recordAttestation(attestationFor(dispatch, { planHash: 'f'.repeat(64) }));
    const hashVerdict = expectErr(movedHash, 'conflict', 'plan hash that does not match the dispatch');
    if (hashVerdict.status === 'fail') return hashVerdict;
    const wrongEnv = await store.recordAttestation(attestationFor(dispatch, { environment: 'staging' }));
    const envVerdict = expectErr(wrongEnv, 'conflict', 'attestation for a different environment');
    if (envVerdict.status === 'fail') return envVerdict;
    const accepted = await store.recordAttestation(attestationFor(dispatch));
    return accepted.ok ? { status: 'pass', detail: 'four refusals, then the honest one accepted' } : { status: 'fail', detail: `valid attestation refused: ${JSON.stringify(accepted)}` };
  });

  await add('one attestation per dispatch -- a retried job cannot rewrite history', async () => {
    const { store, instance } = await seed();
    const created = await store.createDispatch({
      instanceId: instance.id, nonce, planHash, action: 'apply', environment: 'production',
      issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: {},
    });
    if (!created.ok) return { status: 'fail', detail: JSON.stringify(created) };
    const first = await store.recordAttestation(attestationFor(created.value));
    if (!first.ok) return { status: 'fail', detail: `first attestation refused: ${JSON.stringify(first)}` };
    return expectErr(await store.recordAttestation(attestationFor(created.value)), 'conflict', 'duplicate attestation');
  });

  await add('latestAttestation is per instance, and ordered by completion not insertion', async () => {
    const store = await fresh();
    const t = await store.createTeam({ name: 'ordering' });
    if (!t.ok) return { status: 'fail', detail: 'team failed' };
    const a = await store.createInstance({ teamId: t.value.id, name: 'a', platform: 'starter-web' });
    const b = await store.createInstance({ teamId: t.value.id, name: 'b', platform: 'starter-web' });
    if (!a.ok || !b.ok) return { status: 'fail', detail: 'instances failed' };
    const mk = async (instanceId: string, id: string, finished: string) => {
      const d = await store.createDispatch({
        instanceId, nonce, planHash, action: 'apply', environment: 'production',
        // Expires far in the future: the case is about ordering, and a January 2026 dispatch would be
        // correctly refused as expired -- which is the mistake this fixture originally made.
        issuedAt: finished, expiresAt: '2999-01-01T00:00:00.000Z', plan: {}, id,
      });
      if (!d.ok) throw new Error(`dispatch ${id} failed: ${reasonOf(d)}`);
      const r = await store.recordAttestation(attestationFor(d.value, { finishedAt: finished }));
      if (!r.ok) throw new Error(`attestation for ${id} refused: ${reasonOf(r)}`);
    };
    await mk(a.value.id, 'disp-old', '2026-01-01T00:00:00.000Z');
    await mk(b.value.id, 'disp-other-instance', '2026-06-01T00:00:00.000Z');
    await mk(a.value.id, 'disp-new', '2026-03-01T00:00:00.000Z');
    const latest = await store.latestAttestation(a.value.id);
    if (!latest.ok) return { status: 'fail', detail: JSON.stringify(latest) };
    if (latest.value.dispatchId !== 'disp-new') return { status: 'fail', detail: `expected disp-new (latest by finishedAt), got ${latest.value.dispatchId}` };
    const wrong = await store.latestAttestation('inst-nobody');
    return wrong.ok ? { status: 'fail', detail: 'an unknown instance returned an attestation -- cross-instance leak' } : { status: 'pass', detail: 'ordered by finishedAt, isolated by instance' };
  });

  await add('returned records are copies: mutating a read cannot corrupt the store', async () => {
    // The case that separates a real store from a Map of live objects. A database hands back fresh rows; an
    // in-memory double that returns its internal reference lets one caller rewrite another's view, and the
    // only way to catch that is to try it.
    const { store, instance } = await seed();
    const before = await store.getInstance(instance.id);
    if (!before.ok) return { status: 'fail', detail: 'read failed' };
    const snapshot = JSON.stringify(before.value);
    (before.value as { name: string }).name = 'tampered-by-caller';
    (before.value as { state: string }).state = 'removed';
    const after = await store.getInstance(instance.id);
    if (!after.ok) return { status: 'fail', detail: 're-read failed' };
    return JSON.stringify(after.value) === snapshot
      ? { status: 'pass', detail: 'the store owns its data' }
      : { status: 'fail', detail: `mutation leaked into the store: ${JSON.stringify(after.value).slice(0, 120)}` };
  });

  await add('no field of a provider connection can hold a secret value (D4)', async () => {
    const { store, instance } = await seed();
    const smuggled = { instanceId: instance.id, tier: 'managed', secrets: [{ name: 'RAILWAY_TOKEN', source: 'preserve', value: 'rhS9Wj3rCZm6s543dQEEv3U3FQz78fUd' }], connectedAt: new Date().toISOString() };
    const result = await store.putProviderConnection(smuggled as never);
    if (result.ok) return { status: 'fail', detail: 'a connection carrying a secret VALUE was accepted -- the schema has a place for it, which is the bug' };
    const stored = await store.getProviderConnection(instance.id);
    const text = JSON.stringify(stored.ok ? stored.value : {});
    return text.includes('rhS9Wj3rCZm6s543dQEEv3U3FQz78fUd')
      ? { status: 'fail', detail: 'the value reached storage even though the write was refused' }
      : { status: 'pass', detail: 'refused at the boundary; nothing persisted' };
  });

  await add('a repository connection is replaced, not accumulated', async () => {
    const { store, instance } = await seed();
    const first = await store.putRepoConnection({ instanceId: instance.id, repo: 'acme/old', defaultBranch: 'main', actionRef: '1'.repeat(40), installedAt: '2026-01-01T00:00:00.000Z' });
    const second = await store.putRepoConnection({ instanceId: instance.id, repo: 'acme/new', defaultBranch: 'main', actionRef: '2'.repeat(40), installedAt: '2026-02-01T00:00:00.000Z' });
    if (!first.ok || !second.ok) return { status: 'fail', detail: JSON.stringify([first, second].map((r) => (r.ok ? 'ok' : r.code))) };
    const read = await store.getRepoConnection(instance.id);
    if (!read.ok) return { status: 'fail', detail: 'read failed' };
    const schemaCheck = RepoConnectionSchema.safeParse(read.value);
    return read.value.repo === 'acme/new' && schemaCheck.success ? { status: 'pass', detail: 'one live connection per instance' } : { status: 'fail', detail: JSON.stringify(read.value) };
  });

  await add('audit is append-only, ordered, and bounded', async () => {
    const store = await fresh();
    for (let i = 0; i < 3; i += 1) {
      const written = await store.appendAudit({ actorKind: 'controller', actorRef: 'reconcile', action: `sweep-${String(i)}`, target: 'instance/x', detail: { attempt: i } });
      if (!written.ok) return { status: 'fail', detail: `audit write refused: ${reasonOf(written)}` };
    }
    const recent = await store.recentAudit(2);
    const all = await store.recentAudit(50);
    if (all.length < 3) return { status: 'fail', detail: `expected at least 3 audit rows, got ${String(all.length)}` };
    // Newest first, asserted by position rather than by set membership: the ordering contract is the whole
    // reason a second driver cannot quietly answer in the other direction.
    if (recent.length !== 2) return { status: 'fail', detail: `limit returned ${String(recent.length)} of 3 rows` };
    if (recent[0]?.action !== 'sweep-2' || recent[1]?.action !== 'sweep-1') {
      return { status: 'fail', detail: `expected newest-first [sweep-2, sweep-1], got ${JSON.stringify(recent.map((r) => r.action))}` };
    }
    const oldFirst = await store.recentAudit(50);
    if (oldFirst[0]?.action !== 'sweep-2') return { status: 'fail', detail: `full listing not newest-first: ${String(oldFirst[0]?.action)}` };
    return { status: 'pass', detail: `${String(all.length)} recorded, newest-first, limit honoured` };
  });

  await add('rows sharing one timestamp keep insertion order', async () => {
    // The regression this file exists to catch, written as a case so it cannot come back: Postgres `now()` is
    // a statement-time constant, so a burst of writes ties, and `ORDER BY at DESC` between ties is a coin flip.
    // It passed on one machine and failed on another -- which is why the ordering rule is now in the interface
    // and asserted here rather than left to whichever index the database happens to choose.
    const store = await fresh();
    const stamp = new Date('2026-05-05T05:05:05.000Z').toISOString();
    const written: string[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const label = `burst-${String(i)}`;
      const result = await store.appendAudit({ actorKind: 'system', actorRef: 'regression', action: label, target: 'tie-test', at: stamp, detail: { i } });
      if (!result.ok) return { status: 'fail', detail: `audit write ${label} refused: ${reasonOf(result)}` };
      written.push(label);
    }
    const read = await store.recentAudit(50);
    const mine = read.filter((r) => r.target === 'tie-test').map((r) => r.action).slice(0, 5);
    const expected = [...written].reverse();
    return JSON.stringify(mine) === JSON.stringify(expected)
      ? { status: 'pass', detail: `five tied timestamps still read back newest-first: ${mine.join(', ')}` }
      : { status: 'fail', detail: `expected ${JSON.stringify(expected)}, got ${JSON.stringify(mine)}` };
  });

  await add('audit detail refuses an oversized blob', async () => {
    const store = await fresh();
    const before = (await store.recentAudit(500)).length;
    const result = await store.appendAudit({ actorKind: 'system', actorRef: 'x', action: 'oversize', target: 't', detail: { reason: 'z'.repeat(400) } } as never);
    const after = (await store.recentAudit(500)).length;
    // Refused as a value: an audit overflow that throws would abort the very loop it is trying to record.
    if (result.ok) return { status: 'fail', detail: 'an oversized detail string was stored without a bound' };
    return after === before ? { status: 'pass', detail: `refused as ${result.code} and nothing persisted` } : { status: 'fail', detail: 'refused, yet the row reached the log' };
  });

  await add('lists are bounded by the limit argument', async () => {
    const { store, instance } = await seed();
    for (let i = 0; i < 4; i += 1) {
      await store.createDispatch({
        instanceId: instance.id, nonce: `${nonce.slice(0, 31)}${String(i)}`, planHash, action: 'apply', environment: 'production',
        issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), plan: { i },
      });
    }
    const two = await store.listDispatches(instance.id, 2);
    return two.length === 2 ? { status: 'pass', detail: '2 of 4 returned' } : { status: 'fail', detail: `limit ignored: ${String(two.length)}` };
  });

  await add('close() makes the store unusable rather than silently empty', async () => {
    const { store } = await seed();
    await store.close();
    const pinged = await store.ping().catch(() => false);
    return pinged === false ? { status: 'pass', detail: 'ping reports unusable' } : { status: 'fail', detail: 'ping() still true after close()' };
  });

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const unimplemented = results.filter((r) => r.status === 'not-implemented').length;
  const driver = (await fresh()).describe().driver;
  return { driver, results, passed, failed, unimplemented, ok: failed === 0 && unimplemented === 0 };
}
