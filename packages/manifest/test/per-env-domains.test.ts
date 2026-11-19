import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { buildPlan } from '../src/build-plan.ts';
import { parseCompose } from '../src/compose.ts';
import { validateManifest } from '../src/validate.ts';
import { DEFAULT_STAGING_PREFIX, effectiveDomains, stagingHost } from '../src/environments.ts';
import { parse, renderRailwayIaC } from '../src/index.ts';
import type { Manifest } from '../src/schema.ts';

// A web manifest with staging enabled and one public service, so precedence is testable in both directions.
// Loaded from the same fixture the other build-plan tests use; `api` has NO environmentDomains, which is the
// backward-compatibility case.
const dir = path.resolve('packages/manifest/test/fixtures');
const rawManifest = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
function loadedManifest(name: string): Manifest {
  const result = parse(rawManifest(name));
  if (!result.manifest) throw new Error(`fixture ${name} did not parse: ${JSON.stringify(result.issues)}`);
  return result.manifest;
}
const realDigest = (seed: string): string => `sha256:${Buffer.from(seed).toString('hex').padEnd(64, '0').slice(0, 64)}`;
const pinned = (m: Manifest) => Object.fromEntries(Object.keys(m.spec.services).map((n) => [n, { image: m.spec.services[n]!.image, digest: realDigest(n) }]));

/** The hostnames a plan actually binds for one service in one environment. */
function hostsFor(plan: ReturnType<typeof buildPlan>, envName: string, service: string): string[] {
  return plan.environments.find((e) => e.name === envName)!.domains.filter((d) => d.service === service).map((d) => d.host);
}

// ---------------------------------------------------------------------------------------------
// The failure this exists to prevent: a staging host the derivation cannot name.
// ---------------------------------------------------------------------------------------------

test('D62 expressibility: a site service can name its staging host without stating it twice', () => {
  const parsed = parseCompose(rawManifest('site-per-env-compose.yaml'));
  assert.deepEqual(parsed.issues, [], JSON.stringify(parsed.issues));
  assert.ok(parsed.manifest, 'the composition must produce a manifest');
  assert.deepEqual(validateManifest(parsed.manifest), [], JSON.stringify(validateManifest(parsed.manifest)));

  const plan = buildPlan(parsed.manifest!, { instanceId: 'site-env', teamId: 'platfolio' });

  // Production hosts come from `domains`; staging hosts come from `environmentDomains`, NOT from derivation.
  assert.deepEqual(hostsFor(plan, 'production', 'site'), ['platfolio.dev'], 'production keeps the declared base host');
  assert.deepEqual(hostsFor(plan, 'staging', 'site'), ['preview.platfolio.dev'],
    'staging serves the DECLARED host, not stagingHost()');

  // The proof the whole change turns on: what derivation would have produced, and that the declaration beat it.
  const wouldBe = stagingHost('platfolio.dev', 'staging-');
  assert.equal(wouldBe, 'staging-platfolio.dev', 'the derived name -- the one D62 does not want');
  assert.notDeepEqual(hostsFor(plan, 'staging', 'site'), [wouldBe],
    'a declaration must not be silently overridden by the derivation rule');

  // And the two staging hostnames are now ONE fact: production keeps the base host, staging the declared one,
  // and no third, derived hostname exists anywhere in the plan for this service.
  const siteHosts = [...hostsFor(plan, 'production', 'site'), ...hostsFor(plan, 'staging', 'site')];
  assert.deepEqual(siteHosts.sort(), ['platfolio.dev', 'preview.platfolio.dev'],
    'exactly two hosts, one per environment -- no staging-platfolio.dev sneaking in beside the declared host');
});

// ---------------------------------------------------------------------------------------------
// Precedence, both directions.
// ---------------------------------------------------------------------------------------------

test('precedence: a declared environment host wins over derivation', () => {
  const base = loadedManifest('web-app-manifest.yaml');
  const api = base.spec.services.api!;
  const withDecl: Manifest = {
    ...base,
    spec: {
      ...base.spec,
      services: { ...base.spec.services, api: { ...api, environmentDomains: { staging: ['preview.example.com'] } } },
    },
  };
  const plan = buildPlan(withDecl, { instanceId: 'i-win', teamId: 't', images: pinned(withDecl) });
  assert.deepEqual(hostsFor(plan, 'staging', 'api'), ['preview.example.com'], 'declared wins');
  assert.deepEqual(hostsFor(plan, 'production', 'api'), ['api.example.com'], 'production is untouched by a staging declaration');
});

test('precedence: absent a declaration, derivation applies unchanged', () => {
  const base = loadedManifest('web-app-manifest.yaml');
  const plan = buildPlan(base, { instanceId: 'i-derive', teamId: 't', images: pinned(base) });
  assert.deepEqual(hostsFor(plan, 'staging', 'api'), ['staging-api.example.com'],
    'the old name, byte for byte -- existing platforms keep what they had');
});

test('effectiveDomains is the whole rule, and the fallback is identity-free of the new field', () => {
  // Called with no environmentDomains, the resolver reproduces production verbatim and staging derived, exactly
  // as the plan emitted before D68 -- this is the function the plan and the validator share, so they cannot drift.
  const svc = { domains: ['api.example.com', '*.svc.example.com'] };
  assert.deepEqual(effectiveDomains(svc, 'production', 'staging-'), svc.domains);
  assert.deepEqual(effectiveDomains(svc, 'staging', 'staging-'), ['staging-api.example.com', '*.staging-svc.example.com']);
  assert.deepEqual(effectiveDomains({ ...svc, environmentDomains: { staging: ['only.example.com'] } }, 'staging', 'staging-'),
    ['only.example.com'], 'a declaration replaces the whole derived list for that environment');
});

test('the staging prefix has ONE default: plan and rendered IaC cannot disagree (D68 follow-up)', () => {
  // The defect this pins was found while adding per-environment domains, not caused by it: `build-plan.ts` and
  // `validate.ts` fell back to `'staging'` when a composition had no `dns:` block at all, while `schema.ts`
  // (which only applies when `dns:` IS present) and `render.ts` used `'staging-'`. Because stagingHost
  // concatenates without inserting a separator, those are different HOSTNAMES -- `stagingapi.example.com` vs
  // `staging-api.example.com`. A tenant with no dns block would get a plan naming one host and rendered IaC
  // naming another, and no existing test noticed, because every fixture carried a dns block.
  const m = loadedManifest('full-stack-manifest.yaml');
  const noDns = structuredClone(m) as Manifest;
  delete (noDns.spec as { dns?: unknown }).dns;
  assert.equal(noDns.spec.dns, undefined, 'the probe requires the dns block to be genuinely absent');

  const problems = validateManifest(noDns);
  assert.equal(problems.filter((p) => p.code === 'compose-domains-must-be-a-list').length, 0, 'no spurious refusal');

  const plan = buildPlan(noDns, { instanceId: 'i-nodefault', teamId: 't', images: pinned(noDns) });
  const stagingHosts = plan.environments.find((e) => e.name === 'staging')?.domains.map((d) => d.host) ?? [];
  assert.ok(stagingHosts.length > 0, 'the fixture binds staging domains, otherwise this test proves nothing');

  const iac = renderRailwayIaC(noDns);
  const text = Object.values(iac.files).join('\n');
  for (const host of stagingHosts) {
    assert.ok(text.includes(host), `the plan binds "${host}" but the rendered IaC never mentions it -- plan and render disagreed on the staging prefix default`);
    assert.ok(!host.includes('staging-') || !text.includes(host.replace('staging-', 'staging')),
      `both "staging-" and "staging" spellings appear for ${host}: two defaults are in play again`);
  }

  // And the constant is what the contract says, not what one call site happened to use.
  const withDns = loadedManifest('full-stack-manifest.yaml');
  const declared = withDns.spec.dns?.stagingPrefix ?? DEFAULT_STAGING_PREFIX;
  assert.equal(declared, DEFAULT_STAGING_PREFIX, 'the schema default and the fallback constant must be one value');
});

// ---------------------------------------------------------------------------------------------
// Backward compatibility, at the whole-plan level, with no environmentDomains anywhere.
// ---------------------------------------------------------------------------------------------

test('a tenant-style composition with no per-environment domains produces the same plan as before', () => {
  // The strongest form of "existing platforms are unaffected": every host the plan binds for a manifest with no
  // environmentDomains is still exactly what the old inline derivation produced, in the same order.
  const m = loadedManifest('full-stack-manifest.yaml');
  const plan = buildPlan(m, { instanceId: 'i-tenant', teamId: 't', images: pinned(m) });
  const prefix = m.spec.dns?.stagingPrefix ?? DEFAULT_STAGING_PREFIX;
  for (const env of plan.environments) {
    for (const d of env.domains) {
      const svc = m.spec.services[d.service]!;
      assert.ok(svc.environmentDomains === undefined || Object.keys(svc.environmentDomains).length === 0,
        'this fixture declares no per-environment hosts, so this is the unchanged path');
      const expected = env.name === 'production'
        ? svc.domains
        : svc.domains.map((h) => stagingHost(h, prefix));
      assert.ok(expected.includes(d.host), `${env.name} host "${d.host}" is not what derivation produces (${JSON.stringify(expected)})`);
    }
  }
});

test('the IaC comment names the declared staging host, not the derived one', () => {
  const parsed = parseCompose(rawManifest('site-per-env-compose.yaml'));
  assert.ok(parsed.manifest);
  const iac = renderRailwayIaC(parsed.manifest!).files['.railway/railway.ts']!;
  assert.ok(iac.includes('preview.platfolio.dev:4321 (staging)'), 'the exported description of intent is not a second, stale hostname');
  assert.ok(!iac.includes('staging-platfolio.dev'), 'the derived name the declaration replaced must not also appear');
});

// ---------------------------------------------------------------------------------------------
// Validation refusals -- each names the service, the environment, the values, and the fix.
// ---------------------------------------------------------------------------------------------

function codes(m: Manifest): string[] {
  return validateManifest(m).map((i) => i.code);
}
function withApi(m: Manifest, patch: Record<string, unknown>): Manifest {
  const api = { ...m.spec.services.api!, ...patch };
  return { ...m, spec: { ...m.spec, services: { ...m.spec.services, api } } } as Manifest;
}

const web = () => loadedManifest('web-app-manifest.yaml');

test('refused: two environments of one service binding the same host', () => {
  // Staging declares the host production already serves: one hostname cannot answer two environments (D57).
  const m = withApi(web(), { environmentDomains: { staging: ['api.example.com'] } });
  const issues = validateManifest(m);
  assert.ok(issues.some((i) => i.code === 'environment-domains-conflict'), JSON.stringify(issues));
  const c = issues.find((i) => i.code === 'environment-domains-conflict')!;
  assert.match(c.message, /api\.example\.com/);
  assert.match(c.message, /production and "staging"|two environments/, 'names both environments');
});

test('refused: a declared host colliding with another service\'s derived host', () => {
  const m = web();
  // api is public on api.example.com (staging derives staging-api.example.com). Give worker the same domains and
  // declare, on api, the host worker would derive for staging.
  const worker = { ...m.spec.services.worker!, public: true, domains: ['example.com'] };
  const api = { ...m.spec.services.api!, environmentDomains: { staging: ['staging-example.com'] } };
  const patched: Manifest = { ...m, spec: { ...m.spec, services: { ...m.spec.services, api, worker } } };
  assert.deepEqual(codes(patched).filter((c) => c === 'environment-domains-conflict'), ['environment-domains-conflict'],
    'the declared api staging host equals worker\'s derived staging host');
});

test('refused: a declared host that is not a valid hostname', () => {
  const m = withApi(web(), { environmentDomains: { staging: ['https://preview.example.com'] } });
  assert.ok(codes(m).includes('host-form'), JSON.stringify(validateManifest(m)));
});

test('refused: an environment key that the platform does not enable', () => {
  // `preview` exists in the schema but is disabled in the fixture.
  const m = withApi(web(), { environmentDomains: { preview: ['p.example.com'] } });
  assert.ok(codes(m).includes('environment-domains-unknown-environment'), JSON.stringify(validateManifest(m)));
});

test('refused: an environment key the service is not deployed to', () => {
  // worker is placed in production only (no staging) in this fixture's derivation -- assert the refusal regardless.
  const m = web();
  const api = { ...m.spec.services.api!, environments: ['production'] as ('production' | 'staging')[], environmentDomains: { staging: ['preview.example.com'] } };
  const patched: Manifest = { ...m, spec: { ...m.spec, services: { ...m.spec.services, api } } };
  assert.ok(codes(patched).includes('environment-domains-unplaced-environment'), JSON.stringify(validateManifest(patched)));
});

test('refused: production listed in environmentDomains, where domains is already its home', () => {
  const m = withApi(web(), { environmentDomains: { production: ['api.example.com'] } });
  assert.ok(codes(m).includes('environment-domains-production-is-domains'), JSON.stringify(validateManifest(m)));
});

test('refused: an empty declared host list for an environment the service runs in', () => {
  const m = withApi(web(), { environmentDomains: { staging: [] } });
  assert.ok(codes(m).includes('environment-domains-empty'), JSON.stringify(validateManifest(m)));
});

test('refused: a declared staging host identical to what derivation produces', () => {
  // Redundant by construction: stagingHost("api.example.com","staging-") == "staging-api.example.com".
  const derived = stagingHost('api.example.com', 'staging-');
  const m = withApi(web(), { environmentDomains: { staging: [derived] } });
  assert.ok(codes(m).includes('environment-domains-redundant'), JSON.stringify(validateManifest(m)));
});

test('refused: a map-shaped domains in Compose, by name -- not a silently-dropped second spelling', () => {
  // Option (a) is refused rather than accepted: compose's `Array.isArray(...) ? ... : []` would otherwise plan
  // this service with ZERO domains and say nothing. The refusal names the field that owns the claim.
  const compose = `
name: bad-domains
services:
  web:
    image: ghcr.io/acme/web:1.0.0@sha256:${'a'.repeat(63)}b
    expose: ["8080"]
    x-platfolio:
      public: true
      domains:
        staging: [staging.example.com]
x-platfolio:
  metadata: { name: bad, version: 1.0.0, title: Bad, summary: s, kind: web, mode: development }
  environments: { production: { enabled: true, branch: main }, staging: { enabled: true, branch: staging }, preview: { enabled: false } }
`;
  const issues = parseCompose(compose).issues;
  assert.ok(issues.some((i) => i.code === 'compose-domains-must-be-a-list'), JSON.stringify(issues));
  const bad = issues.find((i) => i.code === 'compose-domains-must-be-a-list')!;
  assert.match(bad.message, /environmentDomains/, 'the fix names the field that owns per-environment hosts');
  assert.equal(bad.path, 'services.web.x-platfolio.domains');
});
