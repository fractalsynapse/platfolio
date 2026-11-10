import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bindingStatus, generationOf, resolveBinding, summarise,
  type Binding, type ProviderInstance,
} from '../src/index.ts';

const IDENTITY: ProviderInstance = {
  instanceId: 'inst-keycloak',
  capability: 'identity',
  outputs: {
    issuer: { kind: 'url', value: 'https://auth.example.com/realms/team' },
    client_id: { kind: 'value', value: 'arcnexus' },
    client_secret: { kind: 'secret' },
  },
};
const providers = [IDENTITY];
const dependent = { instanceId: 'inst-app', required: { capability: 'identity', as: ['OIDC_ISSUER'] } };

test('a capability resolves to a concrete instance and records the generation', () => {
  const { binding, issues } = resolveBinding(dependent, providers);
  assert.deepEqual(issues, [], JSON.stringify(issues));
  assert.equal(binding?.providerInstanceId, 'inst-keycloak');
  assert.deepEqual(binding?.values.map((v) => [v.output, v.value]), [
    ['issuer', 'https://auth.example.com/realms/team'],
    ['client_id', 'arcnexus'],
  ]);
  assert.match(String(binding?.providerGeneration), /^[0-9a-f]{8}$/);
});

test('a secret output is recorded as state and never carried as a value (D32)', () => {
  const { binding } = resolveBinding(dependent, providers);
  assert.ok(binding?.secretStates.some((x) => x.output === 'client_secret' && x.state === 'issued-and-placed'));
  assert.ok(!binding!.values.some((v) => v.output === 'client_secret'), 'no secret value in the binding record');
  // `values` is typed url|value, so a secret cannot be represented there at all: the schema, not the
  // assertion, is what forbids it. Asserted as an absence of the output name, which a regression could
  // actually break.
  assert.ok(!binding!.values.some((v) => v.output === 'client_secret'), 'the client secret never enters the value half');
  assert.deepEqual(binding!.secretStates.map((x) => x.output), ['client_secret']);
});

test('no supplier is a state, not an error -- teams bind consumers before the provider exists', () => {
  const r = resolveBinding(dependent, []);
  assert.equal(r.binding, undefined);
  assert.deepEqual(r.issues.map((i) => i.code), ['awaiting-provider']);
  const optional = resolveBinding({ instanceId: 'inst-app', required: { capability: 'identity', required: false } }, []);
  assert.deepEqual(optional.issues, [], 'optional capabilities stay quiet when absent');
});

test('two suppliers is refused rather than guessed', () => {
  const r = resolveBinding(dependent, [IDENTITY, { ...IDENTITY, instanceId: 'inst-authentik' }]);
  assert.deepEqual(r.issues.map((i) => i.code), ['ambiguous-provider']);
  assert.match(r.issues[0]!.message, /inst-keycloak, inst-authentik/);
});

test('a provider publishing new outputs surfaces as rebind-required, not a silent refresh', () => {
  const { binding } = resolveBinding(dependent, providers);
  assert.equal(bindingStatus(binding!, providers).status, 'ok');
  const rotated: ProviderInstance[] = [{ ...IDENTITY, outputs: { ...IDENTITY.outputs, issuer: { kind: 'url', value: 'https://auth.example.com/realms/new' } } }];
  const status = bindingStatus(binding!, rotated);
  assert.equal(status.status, 'rebind-required');
  assert.match(status.detail, /still pointed at the previous set/);
  assert.notEqual(generationOf(IDENTITY.outputs), generationOf(rotated[0]!.outputs));
});

test('a removed supplier is reported as provider-gone', () => {
  const { binding } = resolveBinding(dependent, providers);
  assert.equal(bindingStatus(binding!, []).status, 'provider-gone');
});

test('a lost credential asks for re-issue, because replay would require having kept it', () => {
  const lost: Binding = { ...(resolveBinding(dependent, providers).binding)!, secretStates: [{ output: 'client_secret', state: 're-issue-required' }] };
  const status = bindingStatus(lost, providers);
  assert.equal(status.status, 're-issue-required');
  assert.match(status.detail, /replay is not possible/);
});

test('generation is order-independent and value-sensitive', () => {
  const a = generationOf({ x: { kind: 'value', value: '1' }, y: { kind: 'value', value: '2' } });
  const b = generationOf({ y: { kind: 'value', value: '2' }, x: { kind: 'value', value: '1' } });
  assert.equal(a, b, 'key order is not a change');
  assert.notEqual(a, generationOf({ x: { kind: 'value', value: '1' }, y: { kind: 'value', value: '3' } }));
});

test('the team summary is what lets a UI say "two of three consumers are stale"', () => {
  const base = resolveBinding(dependent, providers).binding!;
  const other: Binding = { ...base, dependentInstanceId: 'inst-two' };
  const fresh: Binding = { ...base, dependentInstanceId: 'inst-three' };
  const rotated: ProviderInstance[] = [{ ...IDENTITY, outputs: { ...IDENTITY.outputs, issuer: { kind: 'url', value: 'https://changed' } } }];
  const [row] = summarise([base, other, fresh], [IDENTITY]);
  assert.deepEqual([row!.ok, row!.total], [3, 3]);
  const stale = summarise([base, { ...other, providerGeneration: '00000000' }, { ...fresh, providerGeneration: '00000000' }], [IDENTITY]);
  assert.equal(stale[0]!.attention.length, 2);
  assert.equal(stale[0]!.ok, 1);
});

test('the two reference templates describe a provider and a consumer of the same capability', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { parse } = await import('../../manifest/src/index.ts');
  const read = (name: string) => fs.readFileSync(path.resolve('templates', name, 'manifest.yaml'), 'utf8');
  const provider = parse(read('example-full-stack')).manifest!;
  const consumer = parse(read('example-web-app')).manifest!;

  assert.equal(provider.spec.provides?.name, 'identity');
  assert.ok(provider.spec.provides?.outputs.some((o) => o.output === 'issuer' && o.kind === 'url'));
  assert.ok(provider.spec.provides?.outputs.some((o) => o.output === 'client_secret' && o.kind === 'secret'), 'the credential half is declared as state, not carried');
  assert.deepEqual(consumer.spec.capabilities.map((c) => c.capability), ['identity']);
  assert.deepEqual(consumer.spec.capabilities[0]!.as, ['OIDC_ISSUER'], 'destinations are inventory entry names');

  // The published outputs must be able to satisfy the destinations the consumer declares.
  const outputs = Object.fromEntries((provider.spec.provides?.outputs ?? []).map((o) => [o.output, { kind: o.kind, ...(o.kind !== 'secret' ? { value: `https://example/${o.output}` } : {}) }]));
  const { binding, issues } = resolveBinding({ instanceId: 'inst-consumer', required: { capability: 'identity', as: consumer.spec.capabilities[0]?.as ?? [] } }, [{ instanceId: 'inst-provider', capability: 'identity', outputs }]);
  assert.deepEqual(issues, [], JSON.stringify(issues));
  assert.ok(binding?.values.some((v) => v.output === 'issuer'));
  assert.ok(!binding?.values.some((v) => v.output === 'client_secret'), 'the secret is relayed, never carried into a value');
});
