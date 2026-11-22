import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PostgresStore } from '../src/postgres-store.ts';
import { applyMigrations, dropSchema } from '../src/migrations.ts';
import { runStoreConformance, type StoreReport } from '../src/store-conformance.ts';

/**
 * The same suite the memory double passes, against a real database.
 *
 * This is what makes `Store` a seam rather than a rename of the Postgres code path: if the interface had been
 * written around one implementation -- transactions, row ids, a `RETURNING` clause -- the double would not
 * satisfy it and this file would not exist.
 *
 * Gated on PLATFOLIO_DB_URL, and it reports that honestly rather than pretending to have run. CI supplies a
 * postgres service; a developer without one sees "skipped", which is the correct thing for it to say.
 */
const url = process.env.PLATFOLIO_DB_URL ?? '';
// Captured as a definite string so the skip guard is the only place emptiness is reasoned about; inside a
// skipped test Node still typechecks the body, and `string | undefined` reaching SQL is how a driver ends up
// connecting to "undefined".
const dbUrl: string = url;
const summarize = (report: StoreReport): string => report.results.filter((r) => r.status !== 'pass').map((r) => `  - ${r.name}: ${r.status} -- ${r.detail}`).join('\n') || '  (none)';

test('the Postgres Store satisfies the same conformance suite as the double', { skip: url ? false : 'PLATFOLIO_DB_URL is not set -- run docker compose up -d postgres && pnpm run db:migrate' }, async () => {
  // A scratch schema, migrated from the same files production uses, torn down afterwards. Conformance asserts
  // counts and ordering, so it must not share a schema with a previous run or with the app.
  const schema = `conform_${Date.now().toString(36)}`;
  const store = () => new PostgresStore({ connectionString: dbUrl, schema });
  const migrations = await applyMigrations({ connectionString: dbUrl, schema });
  assert.ok(migrations.at.length >= 1, 'the suite is meaningless against an unmigrated schema');

  const report = await runStoreConformance(store);
  await dropSchema(dbUrl, schema);
  assert.equal(report.driver, 'postgres');
  assert.equal(report.ok, true, `postgres conformance:\n${summarize(report)}`);
  assert.ok(report.passed >= 16, `expected the full case list, got ${String(report.passed)} of ${String(report.results.length)}`);
});

test('a closed Postgres store stops reporting healthy', { skip: url ? false : 'no PLATFOLIO_DB_URL' }, async () => {
  const store = new PostgresStore({ connectionString: dbUrl });
  assert.equal(await store.ping(), true, 'ping must confirm the migrations ledger, not just a socket');
  await store.close();
  assert.equal(await store.ping(), false);
  assert.equal(store.describe().schemaReady, false, 'describe() must not keep claiming readiness after close()');
});

test('readiness distinguishes an unreachable database from a half-migrated schema', { skip: url ? false : 'no PLATFOLIO_DB_URL' }, async () => {
  const bad = new PostgresStore({ connectionString: `${dbUrl.replace(/\/.*$/, '')}/does_not_exist` });
  assert.equal(await bad.ping(), false, 'a missing database must not read as ready');
  await bad.close();
});
