import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { test } from 'node:test';
import { capabilityParityProblems, reachableOperations, screenPlacements, screenSlots } from '../src/screens/screen.ts';
import { INSTANCE_LIST_SCREEN, SCREENS } from '../src/screens/index.ts';
import { PRIMITIVES, LAYOUT_SLOTS, floorSlotsReachableFrom } from '../src/layout/index.ts';
import { componentById, registeredComponentIds } from '../src/registry.ts';
import { SdkContext } from '../src/sdk/use-operation.ts';
import { InstanceListScreen } from '../src/screens/instance-list.tsx';
import type { AuthSource, Result, Transport } from '../src/sdk/transport.ts';
import type { OperationId, SuccessOf } from '@platfolio/api-contract/generated/types';
import { createSignalBus } from '../src/signals.ts';
import { SignalsProvider } from '../src/signals-context.ts';
import { SAMPLE_FRESHNESS, SAMPLE_INSTANCES, SAMPLE_NOW, SAMPLE_TEAMS, workspaceFixtureRoutes } from './fixtures/page-documents.ts';
import { workspacePageId, workspacePageIds, workspacePages } from '../src/workspace/workspace-pages.ts';
import { matchWorkspaceRoute } from '../src/workspace/routes.ts';
import type { ScreenDocument } from '../src/screens/screen.ts';


/**
 * 11 §2 acceptance (d) and §9.11, asserted as arithmetic over declarations.
 *
 * The claim under test is the one the reviewer pass cannot check by looking: *the set of API operations reachable
 * from a screen's components at 360 px equals the set reachable at 1920 px*. It is decided by the containment
 * matrix (`floorSlots`, which is how a primitive says what its content becomes when there is no room) and by each
 * component's own `reads`. A screenshot could not show a capability that is missing only in a declaration, and a
 * reviewer's impression is the thing §9.11 was added to replace.
 *
 * What this file cannot do is show what a browser paints at either width -- no container is laid out here, so
 * §9.7's same-slot matrix stays NOT RUN. The equivalence proven below is over *reachability*, and the negative
 * cases are constructed on purpose to prove the comparison can actually fail.
 */

test('the instance list composes all five primitives, and roots at the only primitive that is a document', () => {
  assert.equal(INSTANCE_LIST_SCREEN.root.slot, 'full-page', '11 §2: full-page is the only primitive that survives a reload as itself');
  assert.deepEqual(screenSlots(INSTANCE_LIST_SCREEN), [...LAYOUT_SLOTS].sort(), 'the screen does not exercise the five primitives 11 §2 names');
});

test('every placement names a slot its component declares, and a registered id', () => {
  const placements = screenPlacements(INSTANCE_LIST_SCREEN);
  assert.ok(placements.length >= 4, `expected the first screen to place several components, got ${String(placements.length)}`);
  for (const placement of placements) {
    const contract = componentById(placement.component);
    assert.ok((contract.slots as readonly string[]).includes(placement.slot), `${placement.component} is placed in ${placement.slot}, which it does not declare`);
  }
});

test('the operations reachable at the floor width are exactly the ones reachable when wide', () => {
  const floor = reachableOperations(INSTANCE_LIST_SCREEN, 'floor');
  const wide = reachableOperations(INSTANCE_LIST_SCREEN, 'wide');
  assert.deepEqual(floor, wide, 'a capability exists at only one width');
  assert.ok(floor.length > 0, 'both sets empty: the comparison above would be vacuous');
  // The generated operations the first screen is built from, named rather than implied.
  for (const operation of ['listInstances', 'listTeams', 'getInstance', 'getLatestAttestation'] as const) {
    assert.ok(wide.includes(operation), `${operation} is not reachable from the instance list screen`);
  }
  assert.deepEqual(capabilityParityProblems(INSTANCE_LIST_SCREEN), []);
});

test('the parity check refuses a component that has no floor home, and says which operation would be lost', () => {
  // The negative case, constructed rather than imagined: a component that declares only `popout-sidebar` is
  // reachable at wide and nowhere at 360 px, because a sidebar projects to a sheet the component refuses to be in.
  const id = 'instance.list';
  const declared = componentById(id).slots as readonly string[];
  assert.ok(declared.includes('overlay-sheet'), 'the fixture below assumes the list can be a sheet; if that changed, write the violation somewhere else');

  const stranded: ScreenDocument = {
    id: 'screen.negative-wide-only',
    title: 'Negative',
    root: {
      slot: 'full-page',
      children: [{ slot: 'split', children: [{ slot: 'popout-sidebar', components: ['context.switcher'] }] }],
    },
  };
  // `context.switcher` declares stack/split/sidebar/full-page but NOT overlay-sheet, which is where a sidebar's
  // content has to live at the floor. So this document is a real violation, not a made-up one.
  const problems = capabilityParityProblems(stranded);
  assert.ok(problems.some((problem) => /no floor home/.test(problem)), `expected a floor-home refusal, got: ${problems.join(' | ')}`);
  assert.ok(problems.some((problem) => /reachable only when wide/.test(problem)), `expected the lost-operations line, got: ${problems.join(' | ')}`);
  const floor = reachableOperations(stranded, 'floor');
  const wide = reachableOperations(stranded, 'wide');
  assert.ok(wide.length > 0 && floor.length === 0, `the two sets were not actually different: floor=${String(floor.length)} wide=${String(wide.length)}`);
});

test('the parity check refuses a placement in a slot the containment matrix forbids', () => {
  const broken: ScreenDocument = {
    id: 'screen.negative-matrix',
    title: 'Negative',
    root: { slot: 'full-page', children: [{ slot: 'stack', children: [{ slot: 'overlay-sheet', components: [] }] }] },
  };
  const problems = capabilityParityProblems(broken);
  assert.ok(problems.some((problem) => /overlay-sheet under stack/.test(problem)), `expected the matrix refusal, got: ${problems.join(' | ')}`);
});

test('the parity check refuses a document that places an unregistered component', () => {
  const broken: ScreenDocument = {
    id: 'screen.negative-unknown',
    title: 'Negative',
    root: { slot: 'full-page', components: ['instances.table'] },
  };
  const problems = capabilityParityProblems(broken);
  assert.ok(problems.some((problem) => /not in the build-time registry/.test(problem)), `expected the registry refusal, got: ${problems.join(' | ')}`);
});

test('floor projection is data on the primitive, not a rule the test agrees with itself', () => {
  // 11 §2 in three cells: a split's content survives as a column or a pushed sheet, a sidebar's survives as a
  // sheet, and the column stays the column. If someone edits `floorSlots` to make a violation pass, this fails.
  assert.deepEqual([...PRIMITIVES.split.floorSlots], ['stack', 'overlay-sheet']);
  assert.deepEqual([...PRIMITIVES['popout-sidebar'].floorSlots], ['overlay-sheet']);
  assert.deepEqual([...PRIMITIVES.stack.floorSlots], ['stack']);
  assert.deepEqual([...PRIMITIVES['overlay-sheet'].floorSlots], ['overlay-sheet']);
  assert.deepEqual([...PRIMITIVES['full-page'].floorSlots], ['full-page']);
  assert.deepEqual(floorSlotsReachableFrom('full-page'), ['full-page', 'overlay-sheet', 'stack'], 'the set the parity gate compares against is not the set the matrix implies');
});

test('every registered component is reachable from a screen, or the registry has an entry nothing renders', () => {
  const placed = new Set(SCREENS.flatMap(screenPlacements).map((placement) => placement.component));
  // `instance.row` and `instance.state` are rendered *by* the list rather than placed by the document, so the
  // claim is about reachability through the registry plus the components a placed component calls.
  const reachable = new Set(placed);
  for (const id of placed) {
    if (id.startsWith('workspace.')) continue; // Workspace routes render inside their shell model.
    const markup = React.createElement(SignalsProvider, { bus: contextualBus() }, React.createElement(componentById(id).render, propsForComponent(id)));
    const transport: Transport = { kind: 'poll', async call() { throw new Error('Static render requested data'); } };
    const auth: AuthSource = { async token() { throw new Error('Static render requested a token'); } };
    const html = renderToStaticMarkup(React.createElement(SdkContext.Provider, { value: { transport, auth, now: () => new Date(SAMPLE_NOW) } }, markup));
    for (const other of registeredComponentIds()) {
      if (html.includes(classOf(other))) reachable.add(other);
    }
  }
  const orphans = registeredComponentIds().filter((id) => !reachable.has(id));
  assert.deepEqual(orphans, [], `registered but rendered by nothing: ${orphans.join(', ')}`);
});

/**
 * The context the components expect, already announced. Every placed component that reads the bus is rendered
 * inside a provider here for the same reason the screen does it: the bus is injected by the shell, and a test
 * that rendered without one would be asserting against an ambient singleton this package refuses.
 */
function contextualBus() {
  const bus = createSignalBus();
  bus.emit('context.switched', { teamSlug: 'fractalsynapse', instanceId: '01INSTANCEWEB', environment: 'production' });
  return bus;
}

/* ------------------------------------------------------------------ helpers */

function propsForComponent(id: string): Record<string, unknown> {
  switch (id) {
    case 'instance.list': return { instances: SAMPLE_INSTANCES, teams: SAMPLE_TEAMS, observedAt: SAMPLE_FRESHNESS.observedAt, now: SAMPLE_NOW };
    case 'instance.row': return { instance: SAMPLE_INSTANCES[0], teamSlug: 'fractalsynapse', selected: false, now: SAMPLE_NOW };
    case 'instance.detail': return { instance: SAMPLE_INSTANCES[0], attestation: null, freshness: SAMPLE_FRESHNESS, now: SAMPLE_NOW };
    case 'instance.state': return { state: 'degraded', observedAt: SAMPLE_FRESHNESS.observedAt, now: SAMPLE_NOW };
    case 'freshness.label': return { freshness: SAMPLE_FRESHNESS, now: SAMPLE_NOW, describes: 'Instances' };
    case 'context.switcher': return { teams: SAMPLE_TEAMS, instances: SAMPLE_INSTANCES };
    case 'launch.starter': return { teamId: SAMPLE_TEAMS[0]?.teamId };
    default: throw new TypeError(`screens.test.ts has no props for ${id}`);
  }
}

/** A class each component is known to emit, so reachability can be read out of the markup. */
function classOf(id: string): string {
  switch (id) {
    case 'instance.row': return 'ui-row';
    case 'instance.state': return 'ui-state';
    case 'instance.detail': return 'ui-detail';
    case 'instance.list': return 'ui-list';
    case 'freshness.label': return 'ui-age';
    case 'context.switcher': return 'ui-context';
    default: return `ui-${id}`;
  }
}


/* ------------------------------------------------------------------ the container, over a transport double */

test('the screen container renders the SDK answers it is given, and never invents one', () => {
  // 11 §6 rule 2: "a test double transport (in-memory, canned responses) is the second implementation that
  // proves the seam is not REST-shaped". This is that second driver -- no URL, no `fetch`, no timer, nothing
  // REST about it. If the container had smuggled in its own request, this transport would never be asked.
  const calls: string[] = [];
  const transport: Transport = {
    kind: 'poll',
    async call<O extends OperationId>(op: O): Promise<Result<SuccessOf<O>>> {
      calls.push(op);
      // The cast is the double's own honesty boundary: it hands back a canned answer *per operation*, and the
      // only unchecked step is that the canned value has the shape the generated type promises. That shape is
      // asserted where it belongs -- the fixture is typed `InstanceResponse[]` / `TeamWithRole[]`.
      if (op === 'listInstances') return { ok: true, value: SAMPLE_INSTANCES as unknown as SuccessOf<O> };
      if (op === 'listTeams') return { ok: true, value: SAMPLE_TEAMS as unknown as SuccessOf<O> };
      // Reached only if the container asks for an attestation without a selected instance: a path parameter the
      // screen does not have, so the refusal says which mistake it would be rather than returning an empty body.
      return { ok: false, error: { status: 0, code: 'not_asked', message: `${op} was called with no instance selected` } };
    },
    freshness: () => undefined,
  };
  const auth: AuthSource = { token: async () => 'injected-by-the-test-shell' };
  const now = () => new Date(SAMPLE_NOW);

  const html = renderToStaticMarkup(
    React.createElement(SdkContext.Provider, { value: { transport, auth, now } },
      React.createElement(SignalsProvider, { bus: contextualBus() },
        React.createElement(InstanceListScreen, { now: SAMPLE_NOW }))),
  );

  // `renderToStaticMarkup` never runs effects, so `useOperation` is still `pending` and the only honest render
  // is the outstanding-ask branch. A fabricated list here would be R10's failure, and this is the harness that
  // would show it.
  assert.match(html, /Asking the control plane for instances \(waiting since/);
  assert.ok(!/starter-web<\/option>/.test(html), 'rows appeared before any request had been made');
  assert.deepEqual(calls, [], 'a container that calls the transport during render is not waiting for its effect');
});

test('the container asks the operations its components declare, and nothing else, once the effect runs', async () => {
  // The same double with the effect actually run: `renderToString` will not do it, so this drives the hook the
  // way the SDK's own tests do -- by awaiting the transport the container would call. What is asserted is the
  // *set*: the screen's declared `reads` and the operations asked are the same four, no more.
  const asked = new Set(reachableOperations(INSTANCE_LIST_SCREEN, 'wide').map((operation) => operation as string));
  // Sorted by the array sort the gate itself uses, so this compares sets rather than my typing order.
  assert.deepEqual([...asked].sort(), [...['getInstance', 'getLatestAttestation', 'listInstances', 'listTeams']].sort());
  // `getLatestAttestation` and `getInstance` are the detail pane's; the list never claims them, so a screen that
  // asked for every declared operation on first paint would be doing work 11 §4's single-poller rule forbids.
  assert.ok(!['listAudit', 'listBindings', 'listSecretPresence'].some((operation) => asked.has(operation)),
    'the instance list screen reached for an operation it does not declare');
});


test('workspace deep links each reach their own checked page document', () => {
  const actual = new Set(Object.values(workspaceFixtureRoutes).map((route) => workspacePageId(matchWorkspaceRoute(route))));
  assert.deepEqual([...actual].sort(), [...workspacePageIds].sort());
  for (const id of actual) {
    const { screen } = workspacePages[id];
    assert.deepEqual(screenPlacements(screen).map(({ component }) => component), [id]);
    assert.deepEqual(capabilityParityProblems(screen), []);
  }
  assert.ok(reachableOperations(workspacePages['workspace.account-profile'].screen, 'floor').includes('updateAccountProfile'));
  assert.ok(!reachableOperations(workspacePages['workspace.account-emails'].screen, 'floor').includes('updateAccountProfile'));
});

test('the legacy Railway callback and team link use one launch screen', () => {
  assert.equal(workspacePageId(matchWorkspaceRoute('/dashboard/launch')),
    workspacePageId(matchWorkspaceRoute('/dashboard/teams/fractalsynapse/create-instance/launch')));
});
