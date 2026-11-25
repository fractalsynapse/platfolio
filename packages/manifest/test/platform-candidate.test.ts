import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { candidateArtifactResolver, parseReleaseCandidate, resolveCheckoutCandidate } from '../../../scripts/platform-candidate.ts';
import { buildPlan, parseCompose } from '../src/index.ts';
import type { InstanceConfig } from '../src/build-plan.ts';

const commit = 'ab'.repeat(20);
const digestA = `sha256:${'ab'.repeat(32)}`;
const digestB = `sha256:${'cd'.repeat(32)}`;
const image = `ghcr.io/platfolio-fixtures/api:sha-${commit}`;
const composition = readFileSync(new URL('../../../compose.yaml', import.meta.url), 'utf8');

function candidate(digest: string, sourceCommit = commit) {
  return { schemaVersion: 1, sourceCommit, runId: '40', runAttempt: '1', images: {
    api: { image: `ghcr.io/platfolio-fixtures/api:sha-${sourceCommit}`, digest },
    identity: { image: `ghcr.io/platfolio-fixtures/identity:sha-${sourceCommit}`, digest: digestB },
    site: { image: `ghcr.io/platfolio-fixtures/site:sha-${sourceCommit}`, digest: digestA },
  } };
}

function planFor(record: unknown, options: Pick<InstanceConfig, 'domains' | 'environment'> = {}) {
  const resolveArtifact = candidateArtifactResolver(parseReleaseCandidate(record), commit);
  const parsed = parseCompose([composition], { resolveArtifact });
  assert.deepEqual(parsed.issues, []);
  assert.ok(parsed.manifest);
  return buildPlan(parsed.manifest, { instanceId: 'selfhost', teamId: 'platfolio', ...options });
}

test('an older release candidate can be replayed after a later publish', () => {
  const previous = candidate(digestA);
  const first = planFor(previous);
  const next = planFor(candidate(digestB));
  const replay = planFor(previous);
  assert.equal(replay.planHash, first.planHash);
  assert.notEqual(replay.planHash, next.planHash);
  for (const environment of replay.environments) {
    const api = environment.services.find((service) => service.name === 'api');
    assert.equal(api?.image, image);
    assert.equal(api?.digest, digestA);
    assert.equal(environment.services.find((service) => service.name === 'site')?.digest, digestA);
  }
  const production = replay.environments.find(({ name }) => name === 'production');
  assert.equal(production?.services.find(({ name }) => name === 'identity')?.digest, digestB);
  assert.ok(!production?.services.find(({ name }) => name === 'api')?.env.some(({ name }) => name === 'PLATFOLIO_MARKETPLACE_ENABLED'));
});

test('domain bootstrap options change the hash of the plan they change', () => {
  const record = candidate(digestA);
  const declared = planFor(record);
  const omitted = planFor(record, { domains: 'omit' });
  const generated = planFor(record, { domains: 'generated' });
  assert.ok(declared.environments.some((environment) => environment.domains.length > 0));
  assert.ok(omitted.environments.every((environment) => environment.domains.length === 0));
  assert.ok(generated.environments.flatMap((environment) => environment.domains).every((domain) => domain.host.endsWith('.generated.up.railway.app')));
  assert.equal(new Set([declared.planHash, omitted.planHash, generated.planHash]).size, 3);
});

test('staging selection excludes production from the plan and its hash', () => {
  const record = candidate(digestA);
  const staging = planFor(record, { environment: 'staging' });
  assert.deepEqual(staging.environments.map(({ name }) => name), ['staging']);
  assert.ok(staging.environments.every(({ services }) => services.every(({ name }) => name !== 'identity')));
  const marketplace = staging.environments[0]?.services.find(({ name }) => name === 'api')?.env
    .find(({ name }) => name === 'PLATFOLIO_MARKETPLACE_ENABLED');
  assert.equal(marketplace?.literal, 'true');
  assert.notEqual(staging.planHash, planFor(record).planHash);
  assert.throws(() => planFor(record, { environment: 'preview' }), /not enabled/);
});

test('the release candidate refuses a tag, a mismatched checkout, and a missing service', () => {
  assert.throws(() => parseReleaseCandidate(candidate('staging')), /Invalid candidate image for "api"/);
  assert.throws(() => parseReleaseCandidate({ ...candidate(digestA), sourceCommit: 'cd'.repeat(20) }), /tagged for the source commit/);
  const record = parseReleaseCandidate(candidate(digestA));
  assert.throws(() => candidateArtifactResolver(record, 'cd'.repeat(20)), /this checkout is/);
  assert.throws(() => candidateArtifactResolver(record, commit)('worker'), /no published image for service "worker"/);
});

test('the candidate accepts a SemVer release tag only on its exact source commit', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'platfolio-release-tag-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', [
    '-c', 'user.name=Platfolio test', '-c', 'user.email=tests@invalid.test', ...args,
  ], { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('commit', '-qm', 'Earlier release', '--allow-empty', '--no-gpg-sign');
  git('tag', '1.2.2');
  git('commit', '-qm', 'Build candidate', '--allow-empty', '--no-gpg-sign');
  git('tag', '-am', 'Release candidate', '1.2.3-rc.1');
  const sourceCommit = git('rev-parse', 'HEAD');
  const artifact = join(cwd, 'release-candidate.json');
  writeFileSync(artifact, JSON.stringify(candidate(digestA, sourceCommit)));

  assert.equal(resolveCheckoutCandidate(artifact, cwd).releaseTag, null);
  assert.equal(resolveCheckoutCandidate(artifact, cwd, '1.2.3-rc.1').releaseTag, '1.2.3-rc.1');
  assert.throws(() => resolveCheckoutCandidate(artifact, cwd, '1.2.2'), /but the candidate was built from/);
  assert.throws(() => resolveCheckoutCandidate(artifact, cwd, '1.2.4'), /Fetch the tag before planning/);
  assert.throws(() => resolveCheckoutCandidate(artifact, cwd, 'staging'), /bare SemVer tag/);
});
