import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildPlan } from '../src/build-plan.ts';
import { parseCompose, renderProdOverlay } from '../src/compose.ts';
import { validateManifest } from '../src/validate.ts';
import { renderCompose } from '../src/render.ts';

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
  metadata: { name: demo, version: 1.0.0, title: Demo, summary: A demo platform, kind: web, mode: development }
  environments:
    production: { enabled: true, branch: main }
    staging: { enabled: true, branch: staging }
    preview: { enabled: false }
  release: { registryImage: ghcr.io/acme/demo, tagPattern: "v*" }
`;

const overlay = (name = 'web', image = 'ghcr.io/acme/demo') =>
  renderProdOverlay(BASE, { [name]: { image, tag: '1.0.0', digest: `sha256:${DIGEST_PIN}` } });

const codes = (docs: string[]) => parseCompose(docs).issues.map((i) => i.code);

test('the authored file alone refuses, and now says which half is missing (D54)', () => {
  // The label changed from `compose-image-unpinned` to `no-artifact` for a BUILT service, because the two cases
  // need different answers: an upstream image with no digest is a document defect, while a build with no
  // reported artifact means "run your pipeline once". Same refusal, sharper reason -- the assertion moved
  // because the message improved, not because the rule weakened.
  assert.deepEqual(codes([BASE]), ['no-artifact']);
  assert.match(parseCompose([BASE]).issues[0]!.message, /publish one/, 'the reason must name the action');
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

test('Compose preserves an explicit health dependency when it renders the manifest', () => {
  const customer = 'services:\n  web:\n    depends_on:\n      worker:\n        condition: service_healthy\n';
  const { manifest, issues } = parseCompose([BASE, overlay(), customer]);
  assert.deepEqual(issues, []);
  assert.ok(manifest);
  assert.deepEqual(manifest.spec.services.web?.dependsOn, ['worker']);
  assert.deepEqual(manifest.spec.services.web?.dependencyConditions, { worker: 'service_healthy' });
  assert.match(renderCompose(manifest).files['docker-compose.yml'] ?? '', /depends_on:\n      worker:\n        condition: service_healthy/);
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

test('platfolio can describe and plan its own deployment (step 7, #172)', () => {
  const root = path.resolve('.');
  // The platform files sit at the repository root now (D50): platfolio is described the way a
  // tenant is, which is the point -- this test reads the same paths the deploy tool reads.
  const dir = root;
  if (!fs.existsSync(path.join(dir, 'compose.yaml'))) {
    assert.fail('compose.yaml is the reference case for D29; it must stay in the tree');
  }
  const base = fs.readFileSync(path.join(dir, 'compose.yaml'), 'utf8');
  const overlay = fs.readFileSync(path.join(dir, 'compose.prod.yaml'), 'utf8');
  const parsed = parseCompose([base, overlay], {
    resolveArtifact: (service) => ['site', 'identity'].includes(service) ? `ghcr.io/platfolio-fixtures/${service}:ci@sha256:${DIGEST_PIN}` : undefined,
  });
  // This used to assert the OPPOSITE -- "the tree cannot describe a deployable self-host" -- because the
  // overlay pinned a digest belonging to a deleted service and had no image of its own. #172 changed that:
  // the pin is now read from the registry by scripts/render-platform-overlay.ts, so the composition renders.
  // The assertion is inverted rather than deleted, and the history is here because the previous state was a
  // real finding, not a mistake to erase.
  assert.deepEqual(parsed.issues.map((x) => x.code), [], JSON.stringify(parsed.issues.map((x) => x.code)));
  assert.ok(parsed.manifest, 'the self-host composition must produce a manifest');
  assert.equal(parsed.manifest.metadata.name, 'platfolio-control-plane');
  assert.equal(validateManifest(parsed.manifest).length, 0, JSON.stringify(validateManifest(parsed.manifest)));

  const services = Object.keys(parsed.manifest.spec.services).sort();
  assert.deepEqual(services, ['api', 'identity', 'site']);

  // 'selfhost' here is the INSTANCE id, which the provider turns into the Railway project name
  // `platfolio-selfhost` (measured, and the live project carries that name). It is not a path: renaming it
  // would look for a different project rather than move a directory.
  const plan = buildPlan(parsed.manifest, { instanceId: 'selfhost', teamId: 'platfolio' });
  const production = plan.environments.find((e) => e.name === 'production');
  assert.ok(production, 'the composition enables production');
  const byName = new Map(production.services.map((s) => [s.name, s]));

  // Every planned service is pinned by digest -- the rule that refused a placeholder for a tenant (#84) is
  // applied to ourselves, which is the only way to know it is a rule and not a tenant-facing formality.
  for (const name of services) {
    const s = byName.get(name);
    assert.ok(s, `${name} missing from the plan`);
    assert.match(s.digest, /^sha256:[0-9a-f]{64}$/, `${name} has no digest pin`);
    assert.ok(s.healthPath.length > 0, `${name} has no health path, so the provider cannot tell live from present`);
  }
  // The command finding from #172: Keycloak is pointless without its start command, and the renderer had been
  // dropping every list-valued Compose `command` on the floor.
  assert.equal(byName.get('identity')?.command, '/opt/keycloak/bin/kc.sh start', 'a list-valued command must survive to the plan, joined with quoting where needed');
  assert.equal(byName.get('api')?.command, undefined, 'the api service has no command override');

  const hosted = production.domains.map((d) => d.host).sort();
  assert.deepEqual(hosted, ['api.platfolio.dev', 'auth.platfolio.dev', 'platfolio.dev']);
  const staging = plan.environments.find((e) => e.name === 'staging');
  assert.ok(staging);
  assert.deepEqual(staging.domains.map((d) => d.host).sort(), ['preview.platfolio.dev', 'staging-api.platfolio.dev']);
  for (const environment of [production, staging]) {
    const apiService = environment.services.find((s) => s.name === 'api')!;
    const siteService = environment.services.find((s) => s.name === 'site')!;
    assert.equal(apiService.healthPath, '/status');
    assert.equal(siteService.healthPath, '/status');
    const api = Object.fromEntries(apiService.env.map((v) => [v.name, v.literal]));
    const site = Object.fromEntries(siteService.env.map((v) => [v.name, v.literal]));
    assert.equal(site.PORT, String(siteService.port));
    const domainFor = (service: string) => environment.domains.find((d) => d.service === service)?.host;
    assert.equal(site.PLATFOLIO_SITE_ORIGIN, `https://${domainFor('site')}`);
    assert.equal(site.PLATFOLIO_SITE_ORIGIN, api.PLATFOLIO_ALLOWED_ORIGINS);
    assert.equal(site.PLATFOLIO_URL, `https://${domainFor('api')}`);
    assert.equal(site.PLATFOLIO_IDENTITY_ISSUER, api.PLATFOLIO_IDENTITY_ISSUER);
  }

  // The API and Keycloak use separate schemas in the same production database.
  assert.deepEqual(production.databases.map((d) => `${d.name}:${d.kind}`), ['main:postgres']);
  for (const [service, variable] of [['api', 'PLATFOLIO_DB_URL'], ['identity', 'KC_DB_URL_HOST'], ['identity', 'KC_DB_PASSWORD']] as const) {
    const refs = byName.get(service)?.references ?? [];
    assert.ok(refs.some((r) => r.variable === variable && r.database === 'main'), `${service} is not wired to the shared database`);
    // #198, asserted rather than commented: a driver that needs components gets components, each naming a
    // SOURCE variable on the database service, and nothing is handed a postgres:// URL it cannot parse.
    if (service === 'identity') {
      assert.ok(refs.every((r) => typeof r.output === 'string' && r.output.length > 0), 'every identity reference must name its source variable');
      assert.equal(refs.find((r) => r.variable === 'KC_DB_URL'), undefined, 'a postgres:// URL must not be handed to a JDBC consumer');
    }
  }
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
  metadata: { name: hibernate-demo, version: 0.1.0, title: Hibernate demo, summary: s, kind: web, mode: hosted }
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

/**
 * Docker appends `command` to the image ENTRYPOINT. Railway's `startCommand` replaces both and runs in a
 * shell. Measured on 2026-11-13 by running one description on each: the full path in `command` worked on
 * Railway and exited instantly locally; the bare argument worked locally and produced `Unknown option:
 * '/opt/keycloak/bin/kc.sh'`. Composing both halves is the only form with one meaning in two runtimes,
 * which is what "the same specification for all four platforms" (D50) has to mean to be true.
 */
test('entrypoint and command compose into one provider start command, in the order a shell would run them', () => {
  const compose = [
    'name: composed',
    'services:',
    '  app:',
    '    image: example/app:1.0.0@sha256:' + DIGEST_PIN,  // a real-shaped digest: #84 refuses a placeholder, and it correctly refused this fixture
    "    entrypoint: ['/usr/local/bin/app']",
    "    command: ['serve', '--config', '/etc/app.conf']",
    '    expose: ["8080"]',
    '    x-platfolio: { public: true, domains: [app.example.com] }',
    'x-platfolio:',
    '  metadata: { name: composed, version: 1.0.0, title: Composed, summary: s, kind: web, mode: hosted }',
    '  environments:',
    '    production: { enabled: true, branch: main }',
    '    staging: { enabled: false }',
    '    preview: { enabled: false }',
    '  release: { registryImage: example/app, tagPattern: "v*" }',
  ].join('\n');
  const parsed = parseCompose(compose);
  assert.ok(parsed.manifest, JSON.stringify(parsed.issues));
  const service = buildPlan(parsed.manifest!, { instanceId: 'i', teamId: 't' }).environments[0]!.services[0]!;
  assert.equal(service.command, '/usr/local/bin/app serve --config /etc/app.conf');

  // Entrypoint with no command is still a start command: Docker would run the entrypoint alone, and the
  // provider needs the same process spelled out.
  const entryOnly = compose.replace("    command: ['serve', '--config', '/etc/app.conf']\n", '');
  const parsed2 = parseCompose(entryOnly);
  assert.ok(parsed2.manifest, JSON.stringify(parsed2.issues));
  assert.equal(buildPlan(parsed2.manifest!, { instanceId: 'i', teamId: 't' }).environments[0]!.services[0]!.command, '/usr/local/bin/app');
});

test('plain development Compose and separate settings produce a pinned hosted manifest', () => {
  const compose = `
services:
  api:
    build: .
    env_file: .env
    ports: ["127.0.0.1:8080:8080"]
    volumes: [".:/app"]
  debugger:
    image: debugger:latest
`;
  const { manifest, issues } = parseCompose(compose, {
    configuration: {
      platform: { metadata: { name: 'plain-compose', version: '1.0.0', title: 'Plain Compose', summary: 'Example project.', kind: 'web', mode: 'hosted' } },
      omitServices: ['debugger'],
      services: { api: { unset: ['env_file', 'volumes'], hosting: { public: true, domains: ['api.example.com'] } } },
    },
    resolveArtifact: () => `ghcr.io/platfolio-fixtures/api:1.0.0@sha256:${DIGEST_PIN}`,
  });
  assert.deepEqual(issues, []);
  assert.ok(manifest);
  assert.deepEqual(validateManifest(manifest), []);
  assert.deepEqual(Object.keys(manifest.spec.services), ['api']);
  assert.equal(manifest.spec.services.api?.digest, 'sha256:' + DIGEST_PIN);
  assert.equal(manifest.spec.services.api?.port, 8080);
  assert.equal(buildPlan(manifest, { instanceId: 'test', teamId: 'test' }).environments[0]?.domains[0]?.host, 'api.example.com');
  assert.match(compose, /env_file: .env/);
});
