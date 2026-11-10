import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveBinding, type Binding, type ProviderInstance } from '@platfolio/contracts';
import { COMPONENT_NAMES } from '../src/page.ts';
import { buildBindingPanel, projectToText } from '../src/index.ts';

const PROVIDERS: ProviderInstance[] = [{
  instanceId: 'inst-keycloak',
  capability: 'identity',
  outputs: {
    issuer: { kind: 'url', value: 'https://auth.example.com/realms/team' },
    client_id: { kind: 'value', value: 'arcnexus' },
    client_secret: { kind: 'secret' },
  },
}];

const bind = (dependent: string): Binding => {
  const { binding } = resolveBinding({ instanceId: dependent, required: { capability: 'identity' } }, PROVIDERS);
  assert.ok(binding, 'fixture must bind');
  return binding;
};

// Built conditionally: under exactOptionalPropertyTypes, `instanceId: undefined` is not the same as
// omitting it, and the optional-parameter shape here is exactly what a caller is most likely to get wrong.
const nodes = (b: Binding[], i?: string) =>
  buildBindingPanel(b, i === undefined ? { providers: PROVIDERS } : { providers: PROVIDERS, instanceId: i }).children;

test('an instance with no bindings says so instead of showing a blank page', () => {
  const rendered = nodes([]);
  assert.ok(rendered.some((n) => n.component === 'notice' && /Nothing here requires a service/.test((n.props as { text: string }).text)));
});

test('one consumer renders as all-connected, with the supplier named', () => {
  const rendered = nodes([bind('inst-app')], 'inst-app');
  const badge = rendered.find((n) => n.component === 'badge');
  assert.equal((badge?.props as { label: string }).label, 'All 1 connected');
  assert.ok(rendered.some((n) => JSON.stringify(n).includes('inst-keycloak')), 'the chosen supplier is visible');
});

test('partial staleness is counted, which is the whole reason this page exists', () => {
  const current = bind('inst-a');
  const stale: Binding = { ...bind('inst-b'), providerGeneration: 'deadbeef' };
  const gone: Binding = { ...bind('inst-c'), providerInstanceId: 'inst-retired' };
  const rendered = nodes([current, stale, gone]);
  const badge = rendered.find((n) => n.component === 'badge');
  assert.equal((badge?.props as { label: string }).label, '2 of 3 need attention');
  assert.equal((badge?.props as { tone: string }).tone, 'problem');
  assert.ok(rendered.some((n) => JSON.stringify(n).includes('Supplier changed') || JSON.stringify(n).includes('still pointed at the previous set')));
  assert.ok(rendered.some((n) => JSON.stringify(n).includes('no longer provides')));
});

test('a rebind is offered, never applied silently', () => {
  const stale: Binding = { ...bind('inst-b'), providerGeneration: 'deadbeef' };
  const actions = nodes([stale]).filter((n) => n.component === 'action-button');
  assert.ok(actions.some((n) => (n.props as { action: string }).action === 'rebind'), JSON.stringify(actions));
  assert.ok(!nodes([bind('inst-a')]).some((n) => n.component === 'action-button' && (n.props as { action: string }).action === 'rebind'), 'a current binding offers nothing to fix');
});

test('a secret output is state plus a re-issue action, and never a value', () => {
  const lost: Binding = { ...bind('inst-app'), secretStates: [{ output: 'client_secret', state: 're-issue-required' }] };
  const rendered = nodes([lost], 'inst-app');
  const badges = rendered.filter((n) => n.component === 'badge');
  assert.ok(badges.some((n) => /needs re-issue/.test((n.props as { label: string }).label)));
  const actions = rendered.filter((n) => n.component === 'action-button');
  assert.ok(actions.some((n) => (n.props as { action: string }).action === 'reissue-secret'));
  // The label legitimately reads "client_secret: needs re-issue", so searching text for a colon proves
  // nothing. What could leak is a value, so the assertion is structural instead.
  const page = buildBindingPanel([lost], { providers: PROVIDERS, instanceId: 'inst-app' });
  const json = JSON.stringify(page);
  assert.ok(!json.includes('"value"'), 'no value field is carried for any output in the secret half');
  assert.ok(!json.includes('"secret-field"'), 'the panel never offers to type a credential in');
  const secretOnly = page.children.filter((n) => JSON.stringify(n).includes('client_secret'));
  assert.ok(secretOnly.length > 0 && secretOnly.every((n) => n.component === 'badge' || n.component === 'action-button' || n.component === 'notice'),
    `secret output leaked into ${secretOnly.map((n) => n.component).join(',')}`);
});

test('public values are shown because they are public', () => {
  const text = projectToText(buildBindingPanel([bind('inst-app')], { providers: PROVIDERS, instanceId: 'inst-app' }));
  assert.ok(text.includes('https://auth.example.com/realms/team'), 'an issuer URL is advertised information');
  assert.ok(text.includes('arcnexus'), 'client id likewise');
});

test('ids are unique, because a renderer keys components by them', () => {
  const all = nodes([bind('inst-a'), { ...bind('inst-b'), providerGeneration: 'cafe1234' }]);
  const ids = all.map((n) => (n.props as { id: string }).id);
  assert.equal(new Set(ids).size, ids.length, `duplicates: ${ids.filter((x, i) => ids.indexOf(x) !== i).join(', ')}`);
});

test('every component the panel emits is one the renderers already know', () => {
  const page = buildBindingPanel([bind('inst-app')], { providers: PROVIDERS, instanceId: 'inst-app' });
  // Assert against what the panel actually emits, not a wish list: a current binding has no action-button
  // at all, so the previous version of this check passed by luck rather than by coverage.
  const stalePage = buildBindingPanel([{ ...bind('inst-a'), providerGeneration: 'ab12cd34' }], { providers: PROVIDERS, instanceId: 'inst-a' });
  const emitted = new Set<string>();
  const walk = (n: unknown) => {
    const node = n as { component?: string; children?: unknown[] };
    if (node?.component) emitted.add(node.component);
    for (const c of node.children ?? []) walk(c);
  };
  walk(stalePage);
  for (const name of emitted) assert.ok((COMPONENT_NAMES as readonly string[]).includes(name), `unregistered component ${name}`);
  assert.ok(emitted.has('action-button'), 'the stale case must exercise the action path');
  assert.ok(projectToText(stalePage).includes('POST rebind'), 'and the text projection must reach it');
});
