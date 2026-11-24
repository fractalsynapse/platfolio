import { SdkProvider, type SdkContextValue } from '../src/sdk/use-operation.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { componentById, registeredComponentIds } from '../src/registry.ts';
import { createSignalBus, SIGNALS } from '../src/signals.ts';
import { SignalsProvider, useSignalValue } from '../src/signals-context.ts';
import { COMPONENT_RULES } from '../src/components/style.ts';
import { SELECTABLE_ENVIRONMENTS } from '../src/components/enums.ts';
import { STALE_AFTER_SECONDS } from '../src/components/freshness.ts';
import {
  SAMPLE_ATTESTATION, SAMPLE_FRESHNESS, SAMPLE_INSTANCES, SAMPLE_NOW, SAMPLE_PROPS,
} from './fixtures/page-documents.ts';
import { createMutationSandbox } from './mutation-sandbox.ts';
import type { SignalBus } from '../src/signals.ts';

/**
 * What the first real screens actually say, read out of the markup they produce.
 *
 * ## The method, and the exact size of what it proves
 *
 * `renderToStaticMarkup` renders a React tree to an HTML string with no browser: no DOM, no layout, no effects.
 * That is enough for the *structural* half of 11 §8 -- which roles exist, which labels are associated with which
 * controls, which region announces, which class carries the hit-target floor, which `reads`-declared data reaches
 * the text. It is not enough for the behavioural or geometric half, and this file does not pretend otherwise:
 *
 * - **focus order, focus trap, Escape-to-pop, restore-on-pop**: nothing paints and no effect runs, so where focus
 *   goes cannot be shown here. Gates §9.7 and §9.8 stay NOT RUN. The DOM-order assertions below are a *necessary*
 *   condition of "tab order equals visual stack order" (11 §8), not that condition.
 * - **44 x 44 px**: the class is asserted on the control, the class is shown to exist in the generated
 *   stylesheet, and the stylesheet is shown to reference the token. What a browser finally paints is a layout
 *   engine's answer; 11 §9.8's target-size audit is not run by anything in this change.
 * - **axe-core**: not installed, not run, not substituted by the assertions below.
 *
 * Effects are absent too, which is why the context is injected through a bus that has *already* emitted:
 * `useSignalValue` takes its initial value from the store (the `peek` path), so a replayed context is visible in
 * the first render of a static tree. That is 11 §3 acceptance (d) reached by the one route a harness without a
 * browser has, and it is described that way rather than claimed as late-mount testing in a page.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * This suite *reads* `fixtures/page-documents.ts`, and `gates-falsify.test.ts` mutates that file in place to
 * prove §9.5 refuses what it claims to refuse. `node --test` runs the two files in parallel processes, so the
 * fixture this suite evaluates can be the mutated one -- measured, not theorised: with the mutation in flight,
 * the refusal test below failed with `no instances at all was accepted`, in a suite that touches no file.
 *
 * So the invalid-prop-set fixture is read through the sandbox: under the tree lock, and as a fresh module
 * instance, which is what makes the wait mean something (a cached import would keep whatever bytes the first
 * evaluation saw, poisoned or not). Everything else here is props data the mutations do not change.
 */
const sandbox = createMutationSandbox({ root: ROOT });

/** A bus that has already announced the context a screen is normally rendered into. */
function contextualBus(): SignalBus {
  const bus = createSignalBus();
  bus.emit('context.switched', { teamSlug: 'fractalsynapse', instanceId: '01INSTANCEWEB', environment: 'production' });
  return bus;
}

/** Fixture props for a registered id, refused rather than passed through as `undefined`. */
function propsFor(componentId: string): Record<string, unknown> {
  const props = SAMPLE_PROPS[componentId];
  assert.ok(props, `no fixture props for ${componentId}: the fixture and the registry have drifted apart`);
  return props;
}

/**
 * Render a registered component the way React renders it -- as a component, not as a call, and inside the
 * providers the shell injects.
 *
 * Neither part is ceremony. `contract.render` is a function, and calling it directly puts `useState`/`useEffect`
 * outside a fiber (measured: every hook-bearing component threw). And a component that reads the bus without a
 * `SignalsProvider` is supposed to throw, because an ambient bus would let one shell read another shell's context
 * selection -- so the harness provides it, the way `renderScreen` does inside the package.
 */
function render(componentId: string, props: Record<string, unknown>, bus: SignalBus = contextualBus()): string {
  const contract = componentById(componentId);
  const sdk: SdkContextValue = {
    transport: { kind: 'poll', call: async () => ({ ok: false, error: { status: 503, code: 'fixture', message: 'No request during static rendering' } }) },
    auth: { token: async () => { throw new Error('No token during static rendering'); } },
    now: () => new Date(SAMPLE_NOW),
  };
  return renderToStaticMarkup(React.createElement(SdkProvider, { value: sdk },
    React.createElement(SignalsProvider, { bus }, React.createElement(contract.render, props))));
}

/* ------------------------------------------------------------------ registration renders */

test('every registered component renders from its own validated props without throwing', () => {
  const ids = registeredComponentIds();
  assert.ok(ids.length >= 6, `expected the first screens' components to be registered, got ${String(ids.length)}`);
  for (const id of ids) {
    const props = propsFor(id);
    const problems = componentById(id).props['~standard'].validate(props);
    assert.ok(!(problems instanceof Promise) && !problems.issues, `${id} fixture props invalid: ${JSON.stringify(problems)}`);
    assert.ok(render(id, props).length > 0, `${id} rendered nothing at all -- 11 §9.5's empty div`);
  }
});

test('the invalid prop sets named in the fixture really are refused', async () => {
  // The other half of "registration resolves": a suite that only checks the happy path is a fixture list with the
  // word "invalid" in a comment beside it.
  //
  // Read through the sandbox, because the file these come from is the one `gates-falsify.test.ts` edits in place
  // to prove this very refusal is real. Waiting for the tree is only half of it: the module also has to be
  // evaluated *after* the wait, so an import cached during someone else's mutation cannot be the evidence here.
  const fixture = await sandbox.importQuietly<typeof import('./fixtures/page-documents.ts')>(
    'read the invalid prop sets',
    new URL('./fixtures/page-documents.ts', import.meta.url).href,
  );
  for (const bad of fixture.BAD_PROPS) {
    const problems = componentById(bad.page.component).props['~standard'].validate(bad.page.props);
    assert.ok(!(problems instanceof Promise) && problems.issues && problems.issues.length > 0, `${bad.label} was accepted`);
  }
});

/* ------------------------------------------------------------------ rule 2: no width in a component */

test('the list renders no inline width and no device word', () => {
  const html = render('instance.list', propsFor('instance.list'));
  assert.ok(!/style=/.test(html), `a component set an inline style: ${html.slice(0, 200)}`);
  assert.ok(!/\b(isMobile|compact|dense|desktop|tablet|phone)\b/i.test(html), 'a device word reached the rendered output');
  assert.ok(html.includes('ui-list'), 'the list has no class for the stylesheet to attach the reset to');
});

test('the interactive controls carry the class that holds the 44 px floor', () => {
  const markup = [
    ['switcher', render('context.switcher', propsFor('context.switcher'))],
    ['row', render('instance.row', propsFor('instance.row'))],
  ] as const;
  for (const [name, html] of markup) {
    const targets = [...html.matchAll(/<(button|select)\b([^>]*)>/g)];
    assert.ok(targets.length > 0, `${name} rendered no interactive target, so the assertion below is vacuous`);
    for (const [, tag, attrs] of targets) {
      assert.ok(/ui-hit-primary/.test(attrs ?? ''), `${name} <${tag}> has no hit-target class: ${attrs}`);
    }
  }

  // The class is not a spelling mistake shared between two files: it comes from the table the stylesheet is
  // generated from, and the stylesheet references the token instead of repeating the number.
  const primary = COMPONENT_RULES.find((rule) => rule.selector === '.ui-hit-primary');
  assert.ok(primary, 'the component rule table has no .ui-hit-primary, so nothing in the CSS carries 11 §8');
  assert.ok(primary.declarations.includes('min-block-size: var(--ui-target-primary);'), 'the primary rule does not reference the token');
  const css = fs.readFileSync(path.join(ROOT, 'packages/ui/src/components/components.css'), 'utf8');
  assert.match(css, /\.ui-hit-primary \{[^}]*min-inline-size: var\(--ui-target-primary\)/s);
  const tokens = fs.readFileSync(path.join(ROOT, 'packages/ui/src/tokens.css'), 'utf8');
  assert.match(tokens, /--ui-target-primary: 44px;/, 'the token the class references is not 44 px');
});

/* ------------------------------------------------------------------ rules 1 and 5: provenance and age */

test('every server-derived state word arrives with the age of the observation beside it', () => {
  for (const id of ['instance.state', 'instance.row', 'instance.detail', 'instance.list']) {
    assert.match(render(id, propsFor(id)), /class="ui-age/, `${id} renders server data with no age label`);
  }
  assert.match(render('freshness.label', propsFor('freshness.label')), /polled/, 'the transport is not named, so a polled fact could read as a push one (rule 5)');
});

test('an observation older than the stated threshold says so in words, not only in colour', () => {
  const stale = { ...SAMPLE_FRESHNESS, observedAt: new Date(Date.parse(SAMPLE_NOW) - (STALE_AFTER_SECONDS + 60) * 1000).toISOString() };
  const html = render('freshness.label', { freshness: stale, now: SAMPLE_NOW, describes: 'Instances' });
  assert.match(html, /ui-age--stale/);
  assert.match(html, /may be out of date/, 'the doubt is carried by a class only, which 11 §8 refuses for anything a person acts on');
  assert.ok(!render('freshness.label', propsFor('freshness.label')).includes('ui-age--stale'), 'a fresh observation reads as doubtful, which trains people to ignore the warning');
});

test('the state token shown is the contract own word, with no softer gloss invented beside it', () => {
  const html = render('instance.state', propsFor('instance.state'));
  assert.match(html, /degraded/, 'the contract state word was not rendered');
  assert.ok(!/unhealthy|having trouble|not great/i.test(html), `a gloss replaced the contract's word: ${html}`);
});

/* ------------------------------------------------------------------ rule 3: context is a subscription */

test('a component mounted after the context changed shows the selected context on its first render', () => {
  // 11 §3 acceptance (d), by the only route a harness without a browser has: the emit happens before the render,
  // and the hook's initial value comes from the store rather than from an effect.
  const html = render('instance.detail', {
    instance: SAMPLE_INSTANCES[0], attestation: SAMPLE_ATTESTATION, freshness: SAMPLE_FRESHNESS, now: SAMPLE_NOW,
  });
  assert.match(html, /fractalsynapse\/starter-web/, 'the address was not composed from the replayed context');
  assert.match(html, /Latest run/);
});

test('a transient signal leaves a late render silent, which is the half that makes the above mean anything', () => {
  const seen: unknown[] = [];
  const Probe = (): React.ReactElement => {
    seen.push(useSignalValue('instance.state-changed'));
    return React.createElement('span', null, 'probe');
  };
  const bus = createSignalBus();
  bus.emit('instance.state-changed', { instanceId: '01INSTANCEWEB', environment: 'production', from: 'pending', to: 'degraded' });
  renderToStaticMarkup(React.createElement(SignalsProvider, { bus }, React.createElement(Probe)));
  assert.deepEqual(seen, [null], 'a transient signal was replayed into a late render -- that is a value that re-fires an action');

  const replayed: unknown[] = [];
  const Probe2 = (): React.ReactElement => {
    replayed.push(useSignalValue('context.switched'));
    return React.createElement('span', null, 'probe');
  };
  const other = createSignalBus();
  other.emit('context.switched', { teamSlug: 'acme-labs', instanceId: null, environment: 'staging' });
  renderToStaticMarkup(React.createElement(SignalsProvider, { bus: other }, React.createElement(Probe2)));
  assert.deepEqual(replayed, [{ teamSlug: 'acme-labs', instanceId: null, environment: 'staging' }], 'a replay signal did not reach the first render of a late component');
});

test('a component that reaches for the bus uninvited is told what is missing', () => {
  const contract = componentById('instance.list');
  assert.throws(
    () => renderToStaticMarkup(React.createElement(contract.render, propsFor('instance.list'))),
    /outside a <SignalsProvider>/,
    'no provider was refused: an ambient bus would let one shell read another shell context selection',
  );
});

/* ------------------------------------------------------------------ 11 §8: labels and announcements */

test('every control label is associated by id, and the words come from the props schema', () => {
  const html = render('context.switcher', propsFor('context.switcher'));
  const fors = [...html.matchAll(/<label class="ui-label" for="([^"]+)">([^<]*)<\/label>/g)];
  const ids = [...html.matchAll(/<select id="([^"]+)"/g)].map((m) => m[1] as string);
  assert.equal(fors.length, 3, `three controls, three labels: ${JSON.stringify({ labels: fors.length, ids })}`);
  for (const match of fors) {
    const target = match[1] ?? '';
    const text = match[2] ?? '';
    assert.ok(ids.includes(target), `label for "${target}" points at nothing -- 11 §9.5's empty div in a screen reader`);
    assert.ok(text.length > 0, 'an empty label was generated');
  }
  // `name` is a prop of the team schema, so its label is that field's spelling rather than a string typed beside
  // the widget it labels.
  assert.match(html, /for="ui-context-team">Team</);
  assert.match(html, /for="ui-context-environment">Environment</);
});

test('the region that changes from a signal announces politely, and nothing announces assertively', () => {
  const html = render('instance.list', propsFor('instance.list'));
  assert.match(html, /<ul class="ui-list" role="list" aria-live="polite"/);
  assert.ok(!/aria-live="assertive"/.test(html), 'assertive: 11 §8 says signal-driven updates never interrupt');
  // Exactly one polite region: an `aria-live` on the enclosing section as well would announce headings as data.
  assert.equal((html.match(/aria-live/g) ?? []).length, 1, `polite regions: ${html.match(/aria-live="[^"]*"/g)?.join(', ')}`);
});

test('a row is a real button, addressed as team/name, and says which is selected without colour', () => {
  const html = render('instance.row', propsFor('instance.row'));
  assert.match(html, /<button type="button"/);
  assert.match(html, /fractalsynapse\/starter-web/, 'D45: the address a person types is the half of it the row shows');
  assert.match(html, /aria-current="true"/, 'the selected row would otherwise be marked by colour alone');
});

test('the per-environment states are rendered beside the rollup, and the rollup is described as a rollup', () => {
  const html = render('instance.detail', propsFor('instance.detail'));
  assert.match(html, /production/);
  assert.match(html, /staging/);
  assert.match(html, /the rollup of the environments listed under it/, '#179: the rollup is not the truth, and the screen has to say which it is showing');
});

test('a component that has nothing to show says so, and does not render an empty element', () => {
  const bus = createSignalBus();
  bus.emit('context.switched', { teamSlug: 'empty-team', instanceId: null, environment: 'production' });
  const html = render('instance.list', {
    instances: SAMPLE_INSTANCES,
    teams: [{ teamId: '01TEAMCCC', name: 'empty-team', role: 'owner' }],
    observedAt: SAMPLE_FRESHNESS.observedAt,
    now: SAMPLE_NOW,
  }, bus);
  assert.match(html, /empty-team has no instances yet/);
  assert.match(render('instance.detail', { ...propsFor('instance.detail'), attestation: null }), /Nothing has reported for this instance yet/);
});

/* ------------------------------------------------------------------ the join, said out loud */

test('the selector states that a team list is a client-side join, because the spec has no team-scoped list', () => {
  const html = render('context.switcher', propsFor('context.switcher'));
  assert.match(html, /listed from listInstances by teamId/);
  assert.match(html, new RegExp('<option value="01INSTANCEWEB"[^>]*>starter-web</option>'), 'the selected team\'s own instance was not offered');
});

test('the environment choices are the signal payload, read from the registry rather than listed again', () => {
  const std = SIGNALS['context.switched'].payload as unknown as {
    '~standard': { jsonSchema: { input: (o: Record<string, never>) => { properties?: Record<string, { enum?: string[] }> } } };
  };
  const fromSignal = std['~standard'].jsonSchema.input({}).properties?.environment?.enum ?? [];
  assert.ok(fromSignal.length > 0, 'the signal payload exposes no environment enum, so the assertion below proves nothing');
  assert.deepEqual([...SELECTABLE_ENVIRONMENTS], [...fromSignal], 'the selector and the signal no longer name the same environments');
});

test('the stylesheet the classes belong to still reproduces from the module that emits it', () => {
  // Same discipline as `api:types:check`: a hand edit to the CSS is a failure, and the digest is recomputed from
  // the source rather than trusted from the generated file's own header.
  const source = fs.readFileSync(path.join(ROOT, 'packages/ui/src/components/style.ts'));
  const digest = `sha256/${createHash('sha256').update(source).digest('hex').slice(0, 16)}`;
  const committed = fs.readFileSync(path.join(ROOT, 'packages/ui/src/components/components.css'), 'utf8');
  assert.ok(committed.includes(digest), `components.css does not carry the digest of style.ts (${digest}); run \`pnpm run ui:css\``);
});
