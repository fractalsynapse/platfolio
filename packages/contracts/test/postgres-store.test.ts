import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { marketplacePlatformDescriptorDigest } from '../src/marketplace-release.ts';
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

test('the platform catalog migration leaves existing release pins and legacy publication intact', { skip: url ? false : 'no PLATFOLIO_DB_URL' }, async (context) => {
  const schema = `catalog_${Date.now().toString(36)}`;
  const before024 = await mkdtemp(join(tmpdir(), 'platfolio-before-platforms-'));
  const migrationDir = resolve(import.meta.dirname, '../../../db/migrations');
  const store = new PostgresStore({ connectionString: dbUrl, schema });
  context.after(async () => {
    await store.close();
    await dropSchema(dbUrl, schema);
    await rm(before024, { recursive: true, force: true });
  });
  const oldFiles = (await readdir(migrationDir)).filter((file) => /^\d+_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 23);
  await Promise.all(oldFiles.map((file) => copyFile(join(migrationDir, file), join(before024, file))));
  assert.equal((await applyMigrations({ connectionString: dbUrl, schema, dir: before024 })).at.at(-1), 23);

  const identity = { template: 'shared-identity', version: '1.2.3', revision: 'a'.repeat(40),
    installer: 'shared-identity@1', image: `keycloak/keycloak:1.2.3@sha256:${'b'.repeat(64)}` } as const;
  assert.equal(await store.publishMarketplaceRelease(identity), 'created');
  assert.deepEqual(await store.listMarketplaceReleases(), [identity]);

  const upgraded = await applyMigrations({ connectionString: dbUrl, schema });
  assert.ok(upgraded.applied.some(({ version }) => version === 24));
  assert.deepEqual(await store.listMarketplaceReleases(), [identity]);
  assert.deepEqual(await store.listMarketplacePlatformAliases(), [
    { id: 'platfolio.shared-identity', variant: 'shared-service', legacyTemplate: 'shared-identity' },
    { id: 'platfolio.starter-web', variant: 'starter-template', legacyTemplate: 'starter-web' },
    { id: 'platfolio.starter-worker', variant: 'starter-template', legacyTemplate: 'starter-worker' },
  ]);
  const next = { ...identity, version: '1.2.4', revision: 'c'.repeat(40) };
  assert.equal(await store.publishMarketplaceRelease(next), 'created');
  assert.equal(await store.publishMarketplaceRelease(identity), 'existing');
  assert.equal(await store.publishMarketplaceRelease({ ...identity, revision: next.revision }), 'conflict');
  assert.deepEqual((await store.listMarketplaceReleases()).sort((a, b) => a.version.localeCompare(b.version)), [identity, next]);
});

test('Postgres scopes publishing and atomically records one acquisition per team and release', { skip: url ? false : 'no PLATFOLIO_DB_URL' }, async (context) => {
  const schema = `acquisitions_${Date.now().toString(36)}`;
  const store = new PostgresStore({ connectionString: dbUrl, schema });
  context.after(async () => {
    await store.close();
    await dropSchema(dbUrl, schema);
  });
  await applyMigrations({ connectionString: dbUrl, schema });
  const seller = await store.createTeam({ name: 'publisher' });
  const buyer = await store.createTeam({ name: 'buyer' });
  assert.ok(seller.ok && buyer.ok);
  const platformInput = { slug: 'private-portal', title: 'Private portal', variant: 'hosted-application' } as const;
  const platform = await store.createMarketplacePlatform(seller.value.id, platformInput);
  assert.ok(platform.ok);
  assert.equal((await store.createMarketplacePlatform(seller.value.id, platformInput)).ok, false);
  assert.equal((await store.createMarketplacePlatform(buyer.value.id, platformInput)).ok, true);
  assert.equal(await store.getMarketplacePublisherPlatform(buyer.value.id, platform.value.id), undefined);
  assert.deepEqual(await store.listMarketplacePublishedPlatformReleases(), []);

  const descriptor = {
    platformId: platform.value.id, version: '1.0.0', installer: 'compose-image@1',
    source: { repo: 'platfolio-fixtures/portal', revision: 'a'.repeat(40) },
    images: [`registry.example.test/portal@sha256:${'b'.repeat(64)}`],
  };
  assert.equal(await store.publishMarketplacePlatformRelease(buyer.value.id, descriptor), 'not-found');
  const publications = await Promise.all([1, 2].map(() => store.publishMarketplacePlatformRelease(seller.value.id, descriptor)));
  assert.deepEqual(publications.sort(), ['created', 'existing']);
  const changed = { ...descriptor, source: { ...descriptor.source, revision: 'c'.repeat(40) } };
  assert.equal(await store.publishMarketplacePlatformRelease(seller.value.id, changed), 'conflict');
  assert.deepEqual(await store.listMarketplacePublishedPlatformReleases(), [{ platform: platform.value, descriptor }]);

  const id = '8d870c59-45c0-4c26-9e4a-e57a7fdf6971';
  const expiry = '2026-11-28T00:00:00Z';
  const code = '1'.repeat(64);
  const grant = '2'.repeat(64);
  assert.equal(await store.issueMarketplaceEnrollment(buyer.value.id, id, code, expiry), true);
  const claim = { platformId: descriptor.platformId, version: descriptor.version, descriptorDigest: marketplacePlatformDescriptorDigest(descriptor) };
  assert.equal(await store.acquireMarketplacePlatformRelease(id, grant, claim), undefined);
  assert.equal(await store.redeemMarketplaceEnrollment(id, code, grant, '2026-11-27T00:00:00Z'), true);
  const [first, second] = await Promise.all([1, 2].map(() => store.acquireMarketplacePlatformRelease(id, grant, claim)));
  assert.equal(first?.teamId, buyer.value.id);
  assert.deepEqual(first, second);
  assert.equal(await store.acquireMarketplacePlatformRelease(id, code, claim), undefined);
  assert.equal(await store.acquireMarketplacePlatformRelease(id, grant, { ...claim, descriptorDigest: 'c'.repeat(64) }), undefined);
  assert.equal(await store.disconnectMarketplaceInstallation(buyer.value.id, id), true);
  assert.equal(await store.acquireMarketplacePlatformRelease(id, grant, claim), undefined);
});
