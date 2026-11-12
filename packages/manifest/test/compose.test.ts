import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildPlan } from '../src/build-plan.ts';
import { parseCompose, renderProdOverlay } from '../src/compose.ts';
import { validateManifest } from '../src/validate.ts';

// Digests that look like registry output. buildPlan refuses a single repeated character as a template
// placeholder (issue #84), so a fixture built from '2'.repeat(64) would trip the guard it means to exercise.
const DIGEST_WORKER = 'd41d8cd98f00b204e9800998ecf8427e'.repeat(2);
const DIGEST_PIN = '2c26b46b68ffc68ff99b453c1d304134'.repeat(2);
const DIGEST_OTHER = 'fcde3b7251fbb14751e63238b5c125a0'.repeat(2);

const BASE = `
name: demo
services:
  web:
    build: { context: . }
    expose: ["8080"]
    environment: { LOG_LEVEL: info }
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:8080/healthz"]
    volumes:
      - "cache:/data"
    depends_on: [worker]
    x-platfolio:
      public: true
      domains: [app.example.com]
      secrets: [{ name: APP_SECRET, source: preserve }]
      references: [{ variable: DATABASE_URL, database: db }]
  worker:
    image: ghcr.io/acme/worker:1.0.0@sha256:${DIGEST_WORKER}
    expose: ["9000"]
  db:
    image: postgres:16
    x-platfolio: { managed: postgres }
x-platfolio:
  metadata: { name: demo, version: 1.0.0, title: Demo, summary: A demo platform }
  environments:
    production: { enabled: true, branch: main }
    staging: { enabled: false }
    preview: { enabled: false }
  release: { registryImage: ghcr.io/acme/demo, tagPattern: "v*" }
`;

const overlay = (name = 'web', image = 'ghcr.io/acme/demo') =>
  renderProdOverlay(BASE, { [name]: { image, tag: '1.0.0', digest: `sha256:${DIGEST_PIN}` } });

const codes = (docs: string[]) => parseCompose(docs).issues.map((i) => i.code);

test('the authored file alone refuses: no pinned image, no hosted plan', () => {
  assert.deepEqual(codes([BASE]), ['compose-image-unpinned']);
});

test('the generated overlay supplies the pin and the merge is clean', () => {
  const parsed = parseCompose([BASE, overlay()]);
  assert.deepEqual(parsed.issues, [], JSON.stringify(parsed.issues));
  const svc = parsed.manifest!.spec.services.web!;
  assert.equal(svc.image, 'ghcr.io/acme/demo:1.0.0');
  assert.equal(svc.digest, `sha256:${DIGEST_PIN}`);
  assert.equal(svc.healthPath, '/healthz', 'healthcheck URL parsed into the model');
  assert.equal(svc.port, 8080);
  assert.equal(svc.public, true);
  assert.deepEqual(svc.domains, ['app.example.com']);
  assert.deepEqual(svc.dependsOn, ['worker']);
  assert.equal(svc.build, undefined, '!reset removed the dev build from the hosted model');
  assert.equal(parsed.manifest!.spec.services.db, undefined, 'a managed service becomes a resource, not a container');
  assert.deepEqual(parsed.manifest!.spec.resources.database, { name: 'db', kind: 'postgres' });
  assert.deepEqual(validateManifest(parsed.manifest!), [], JSON.stringify(validateManifest(parsed.manifest)));
});

test('the overlay pins tag AND digest, because a bare digest is accepted and never deploys (E26)', () => {
  const text = overlay();
    assert.ok(text.includes(`image: ghcr.io/acme/demo:1.0.0@sha256:${DIGEST_PIN}`), text);
  assert.match(text, /build: !reset null/);
  assert.match(text, /do not edit by hand/);
});

test('fields that cannot be honoured are refused by name, not dropped', () => {
  const withBad = BASE.replace('    expose: ["8080"]', '    expose: ["8080"]\n    env_file: [.env]\n    privileged: true\n    network_mode: host');
  const got = parseCompose([withBad, overlay()]);
  const refused = got.issues.map((i) => `${i.code}:${i.path.split('.').pop()}`);
  assert.ok(refused.includes('compose-unsupported:env_file'), JSON.stringify(refused));
  assert.ok(refused.includes('compose-unsupported:privileged'), JSON.stringify(refused));
  assert.ok(refused.includes('compose-unsupported:network_mode'), JSON.stringify(refused));

  // env_file specifically: Compose's convenience is values arriving from a file, which is the one thing
  // the custody model forbids. The refusal message has to carry the alternative.
  const envIssue = got.issues.find((i) => i.path.endsWith('env_file'))!;
  assert.match(envIssue.message, /x-platfolio\.secrets/);
});

test('a bind mount is refused rather than silently turned into an empty volume', () => {
  const withBind = BASE.replace('"cache:/data"', '"./host-dir:/data"');
  const got = parseCompose([withBind, overlay()]);
  assert.ok(got.issues.some((i) => i.code === 'compose-bind-mount'), JSON.stringify(got.issues));
});

test('an unrecognised Compose field refuses instead of quietly vanishing', () => {
  const withUnknown = BASE.replace('    expose: ["8080"]', '    expose: ["8080"]\n    gpus: 4');
  const got = parseCompose([withUnknown, overlay()]);
  assert.ok(got.issues.some((i) => i.code === 'compose-unknown-field' && i.message.includes('gpus')), JSON.stringify(got.issues));
});

test('an unknown managed kind is refused, not provisioned as a plain container', () => {
  const withManaged = BASE.replace('managed: postgres', 'managed: cockroachdb');
  const got = parseCompose([withManaged, overlay()]);
  assert.ok(got.issues.some((i) => i.code === 'compose-managed-unknown'), JSON.stringify(got.issues));
});

test('a Compose document reaches the same plan the manifest format does', () => {
  const parsed = parseCompose([BASE, overlay()]);
  const plan = buildPlan(parsed.manifest!, { instanceId: 'i-1', teamId: 't-1' });
  assert.equal(plan.provider, 'railway');
  assert.deepEqual(plan.environments[0]!.services.map((s) => s.name), ['web', 'worker']);
  assert.deepEqual(plan.environments[0]!.databases, [{ name: 'db', kind: 'postgres' }]);
  assert.deepEqual(plan.environments[0]!.volumes, [{ name: 'cache', service: 'web', mountPath: '/data' }]);
  assert.deepEqual(plan.environments[0]!.services[0]!.references, [{ variable: 'DATABASE_URL', database: 'db' }]);
});

test('platfolio\'s own service is describable in this format (step 7)', () => {
  const root = path.resolve('.');
  const dir = path.join(root, 'selfhost');
  if (!fs.existsSync(path.join(dir, 'compose.yaml'))) {
    assert.fail('selfhost/compose.yaml is the reference case for D29; it must stay in the tree');
  }
  const base = fs.readFileSync(path.join(dir, 'compose.yaml'), 'utf8');
  const overlay = fs.readFileSync(path.join(dir, 'compose.prod.yaml'), 'utf8');
  const parsed = parseCompose([base, overlay]);

  // What is TRUE today, asserted rather than papered over. The tree cannot describe a deployable self-host,
  // because a deployable description needs a digest and `platfolio-control-plane` has never been built and
  // published. The previous version of this file pinned a digest belonging to `apps/status-api` -- a real
  // digest of bytes whose source no longer exists, which is the worst kind of green: every check passed and
  // the pin pointed at nothing we can account for.
  assert.equal(parsed.manifest, undefined, 'an unpinned first-party service must not produce a plan');
  assert.ok(parsed.issues.some((i) => i.code === 'compose-image-unpinned'), `expected the missing-pin refusal, got ${JSON.stringify(parsed.issues)}`);

  // And what the FORMAT can do, proven with a clearly synthetic pin so the two claims are not confused.
  // This digest is not a build: it exists to check that the reference case would render if #146's release job
  // had produced an image. When that job publishes, the assertion above flips to a real digest and this block
  // becomes redundant -- that is the diff that says self-hosting started working.
    // The SHA-256 of the empty string: valid hex, unmistakably not a build, and refused if anyone later makes
  // the guard accept all-zeros placeholders -- which build-plan already does (#84), as this test discovered by
  // having its own fake pin rejected.
  const SYNTHETIC_PIN = 'services:\n  api:\n    image: ghcr.io/fractalsynapse/platfolio-control-plane:staging@sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\n';
  const renderable = parseCompose([base, SYNTHETIC_PIN]);
  assert.deepEqual(renderable.issues.map((i) => i.code), [], JSON.stringify(renderable.issues.map((i) => i.code)));
  assert.equal(renderable.manifest!.metadata.name, 'platfolio-control-plane');
  assert.equal(validateManifest(renderable.manifest!).length, 0);
  const plan = buildPlan(renderable.manifest!, { instanceId: 'control-plane', teamId: 'platfolio' });
  assert.equal(plan.environments[0]!.services[0]!.healthPath, '/healthz');
  assert.match(plan.environments[0]!.services[0]!.digest!, /^sha256:[0-9a-f]{64}$/, 'a plan without a digest is a plan that can be moved under it');
});

test('the generated prod overlay is deterministic, which is what makes drift detectable', () => {
  const pins = { web: { image: 'ghcr.io/acme/demo', tag: '1.0.0', digest: `sha256:${DIGEST_OTHER}` } };
  assert.equal(overlay('web'), overlay('web'));
  assert.notEqual(overlay('web'), renderProdOverlay(BASE, pins), 'a different pin produces a different file');
});

test('x-platfolio carries volume retention from the Compose document', async () => {
  // The hibernate pattern has to be authorable where everything else is authored, or it stays a provider
  // capability nobody can declare. A mount is the identity that survives its service, so retention is
  // declared on the volume entry and reaches the plan unchanged.
  const { parseCompose } = await import('../src/compose.ts');
  const { applyInventory } = await import('../src/index.ts');
  const base = `
name: hibernate-demo
services:
  worker:
    image: ghcr.io/acme/worker@sha256:` + 'a'.repeat(64) + `
    expose: ["8080"]
x-platfolio:
  resources:
    volumes:
      - { name: state, service: worker, mountPath: /var/lib/state, retention: survive }
  metadata: { name: hibernate-demo, version: 0.1.0, title: Hibernate demo, archetype: api-service, summary: s }
  environments: { production: { enabled: true }, staging: { enabled: false }, preview: { enabled: false } }
`;
  const parsed = parseCompose(base);
  assert.deepEqual(parsed.issues.map((i) => i.code), [], JSON.stringify(parsed.issues));
  const declared = parsed.manifest!.spec.resources.volumes;
  assert.equal(declared.length, 1);
  assert.equal(declared[0]!.retention, 'survive');
  void applyInventory;
});

test('mergeVolumes collapses a declaration and a mount that describe the same disk', async () => {
  const { mergeVolumes } = await import('../src/compose.ts');
  const declared = [{ name: 'job-state', service: 'queue', mountPath: '/var/lib/state', sizeGB: 5, retention: 'survive' }];
  const mounts = [{ name: 'job-state', service: 'queue', mountPath: '/var/lib/state' }];
  const merged = mergeVolumes({ volumes: declared }, mounts);
  assert.equal(merged.length, 1, 'two views of one disk must not become two plan entries -- the second carried no retention and teardown could delete it');
  assert.equal(merged[0]!.retention, 'survive', 'the declaration wins every field it states');

  // The aliasing that made this a real bug: mutating the mount list must not touch the declared array.
  const resources = { volumes: [...declared] };
  mergeVolumes(resources, mounts);
  assert.equal(resources.volumes.length, 1, 'the merge must not mutate the caller array');

  // A mount nobody declared is still a volume -- created with the default retention, not dropped.
  const onlyMount = mergeVolumes({ volumes: [] }, [{ name: 'scratch', service: 'queue', mountPath: '/tmp/scratch' }]);
  assert.equal(onlyMount.length, 1);
  assert.equal(onlyMount[0]!.retention, undefined, 'undeclared means the default, and the default is deletion with the instance');
});
