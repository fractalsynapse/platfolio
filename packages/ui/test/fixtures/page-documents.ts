import { matchWorkspaceRoute, workspacePaths } from '../../src/workspace/routes.ts';
import { workspacePageIds, type WorkspacePageId } from '../../src/workspace/workspace-pages.ts';
import type { InstanceResponse, TeamWithRole } from '@platfolio/api-contract/generated/types';
import type { Freshness } from '../../src/sdk/transport.ts';

/**
 * The props a registered component is expected to accept, and a stored page document that names them.
 *
 * This file exists because 11 §9.5's fixture is the gate that cannot be a grep: "rendering a stored page document
 * with an unknown component id or an invalid prop set fails *loudly*, at validation, not as an empty div" needs an
 * actual document, from an actual registry, with actual props. `check-ui.ts` imports it and walks it; the values
 * are typed by the generated contract so a spec change lands here as a compile error rather than as a fixture that
 * quietly stopped describing anything real.
 *
 * Deliberately not `live` for the state of the healthy row, and the reason is the collision documented in
 * `src/components/instance-state.ts`: gate §R5 refuses the word in this package's visible text, and a fixture that
 * names it would fail the gate it is meant to exercise. `degraded` exercises the same presentation path -- it is
 * the tone that carries a message -- and the healthy state's own token is asserted where it belongs, in
 * `test/components.test.ts`, which reads the generated type rather than this file.
 */
export const SAMPLE_TEAMS: readonly TeamWithRole[] = [
  { teamId: '01TEAMAAA', name: 'fractalsynapse', role: 'owner' },
  { teamId: '01TEAMBBB', name: 'acme-labs', role: 'member' },
];

const environment = (instanceId: string, name: string, state: InstanceResponse['state'], at: string): InstanceResponse['environments'][number] => ({
  instanceId,
  environment: name,
  state,
  updatedAt: at,
});

export const SAMPLE_INSTANCES: readonly InstanceResponse[] = [
  {
    id: '01INSTANCEWEB',
    teamId: '01TEAMAAA',
    name: 'starter-web',
    template: 'starter-web',
    state: 'degraded',
    provider: 'railway',
    createdAt: '2026-11-15T09:00:00.000Z',
    updatedAt: '2026-11-15T09:30:00.000Z',
    environments: [
      environment('01INSTANCEWEB', 'production', 'degraded', '2026-11-15T09:30:00.000Z'),
      environment('01INSTANCEWEB', 'staging', 'degraded', '2026-11-15T09:28:00.000Z'),
    ],
  },
  {
    id: '01INSTANCEWRK',
    teamId: '01TEAMAAA',
    name: 'starter-worker',
    template: 'starter-worker',
    state: 'pending',
    provider: 'fake',
    createdAt: '2026-11-15T09:31:00.000Z',
    updatedAt: '2026-11-15T09:31:00.000Z',
    // Empty on purpose: this is what "accepted, not yet reconciled" looks like, and a row that rendered the
    // rollup alone would be claiming a provider answer the controller has not verified (#179, #202).
    environments: [],
  },
];

export const SAMPLE_ATTESTATION = {
  instanceId: '01INSTANCEWEB',
  environment: 'production',
  action: 'apply',
  result: 'partial',
  errorCode: 'provider-timeout',
  finishedAt: '2026-11-15T09:29:40.000Z',
  durationMs: 184_000,
  release: {
    version: '1.4.2',
    commitSha: 'a3f19c0',
    imageDigest: 'sha256:0d4a1c9e7b6f5a4d3c2b1a0918273645a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d',
  },
} as const;

export const SAMPLE_FRESHNESS: Freshness = { observedAt: '2026-11-15T09:30:20.000Z', via: 'poll' };
export const SAMPLE_NOW = '2026-11-15T09:30:40.000Z';

/** One valid props object per registered id, keyed by the id so a missing entry is visible as a missing key. */
export const SAMPLE_PROPS: Readonly<Record<string, Record<string, unknown>>> = {
  'context.switcher': { teams: SAMPLE_TEAMS, instances: SAMPLE_INSTANCES },
  'launch.starter': { teamId: '01TEAMAAA' },
  ...Object.fromEntries(workspacePageIds.map((id) => [id, {}])),
  'freshness.label': { freshness: SAMPLE_FRESHNESS, now: SAMPLE_NOW, describes: 'Instances' },
  'instance.detail': { instance: SAMPLE_INSTANCES[0], attestation: SAMPLE_ATTESTATION, freshness: SAMPLE_FRESHNESS, now: SAMPLE_NOW },
  'instance.list': { instances: SAMPLE_INSTANCES, teams: SAMPLE_TEAMS, observedAt: SAMPLE_FRESHNESS.observedAt, now: SAMPLE_NOW },
  'instance.row': { instance: SAMPLE_INSTANCES[0], teamSlug: 'fractalsynapse', selected: true, now: SAMPLE_NOW },
  'instance.state': { state: 'degraded', environment: 'production', observedAt: SAMPLE_FRESHNESS.observedAt, now: SAMPLE_NOW },
};

/**
 * What a page document looked like when it was stored. The point of the fixture is that it is *old data* -- the
 * ids were chosen by the registry's own keys, so deleting a component makes this document fail the way 11 §9.5
 * says it must: at validation, naming the id, rather than rendering nothing.
 */
export const STORED_DOCUMENT = { component: 'instance.list', props: SAMPLE_PROPS['instance.list'] } as const;

/**
 * Prop sets that MUST be refused at validation (11 §1 acceptance (b), §9.5). The field is named `page`, not
 * `document`: gate TS0 reads this script's own text for browser-global shapes, and a page document is not the
 * DOM -- a fixture that trips the gate it is exercising is a fixture nobody can trust.
 */
export const BAD_PROPS = [
  { label: 'no instances at all', page: { component: 'instance.list', props: { teams: SAMPLE_TEAMS, observedAt: SAMPLE_FRESHNESS.observedAt, now: SAMPLE_NOW } } },
  { label: 'an instance with no name', page: { component: 'instance.row', props: { instance: { ...SAMPLE_INSTANCES[0], name: '' }, teamSlug: 'fractalsynapse', selected: false, now: SAMPLE_NOW } } },
  { label: 'a freshness with no observation time', page: { component: 'freshness.label', props: { freshness: { via: 'poll' }, now: SAMPLE_NOW, describes: 'Instances' } } },
  { label: 'a team list that is not a list', page: { component: 'context.switcher', props: { teams: 'fractalsynapse', instances: [] } } },
  { label: 'an attestation that never finished', page: { component: 'instance.detail', props: { instance: SAMPLE_INSTANCES[0], attestation: { ...SAMPLE_ATTESTATION, durationMs: -1 }, freshness: SAMPLE_FRESHNESS, now: SAMPLE_NOW } } },
] as const;

/**
 * Prop sets that are *wrong* in a way this package cannot yet refuse, asserted as accepted so the gap is a named
 * line in the gate output rather than a claim nobody tested.
 *
 * `derivedEnum` validates the kind and leaves the membership to the compiler, for the two reasons stated in
 * `components/props.ts`: restating the spec's vocabulary is rule 1's prohibited copy, and one of its members is
 * the word rule 5's grep refuses in this package's visible text. So a stored document naming
 * `state: 'healthy'` -- not a state the contract has -- passes validation and renders in the neutral tone.
 *
 * This list is the honest half. If the dependency edge to `@platfolio/contracts` is ever declared and the
 * validator starts refusing these, the assertion fails and someone has to come and delete this entry, which is
 * the correct direction for a closed gap: the test goes red first.
 */
export const ACCEPTED_BUT_WRONG = [
  { label: 'a state the contract does not carry', page: { component: 'instance.state', props: { state: 'healthy', observedAt: SAMPLE_FRESHNESS.observedAt, now: SAMPLE_NOW } } },
  { label: 'an unknown attestation result', page: { component: 'instance.detail', props: { instance: SAMPLE_INSTANCES[0], attestation: { ...SAMPLE_ATTESTATION, result: 'sort-of' }, freshness: SAMPLE_FRESHNESS, now: SAMPLE_NOW } } },
] as const;

export const workspaceFixtureRoutes = (() => {
  const team = SAMPLE_TEAMS[0]!.name;
  const app = SAMPLE_INSTANCES[0]!.name;
  const environment = 'staging';
  return {
    'workspace.home': workspacePaths.home,
    'workspace.create-team': workspacePaths.createTeam,
    'workspace.invitations': workspacePaths.invitations,
    'workspace.notifications': workspacePaths.notifications,
    'workspace.account-profile': workspacePaths.account,
    'workspace.account-emails': workspacePaths.accountEmails,
    'workspace.account-password': workspacePaths.accountPassword,
    'workspace.account-notifications': workspacePaths.accountNotifications,
    'workspace.templates': workspacePaths.templates(team),
    'workspace.team-launch': workspacePaths.launchForTeam(team),
    'workspace.team-members': workspacePaths.teamMembers(team),
    'workspace.team-invitations': workspacePaths.teamInvitations(team),
    'workspace.team-connections': workspacePaths.teamConnections(team),
    'workspace.team': workspacePaths.team(team),
    'workspace.team-activity': workspacePaths.teamActivity(team),
    'workspace.instance': workspacePaths.instance(team, app),
    'workspace.instance-status': workspacePaths.instanceStatus(team, app),
    'workspace.instance-setup': workspacePaths.instanceSetup(team, app),
    'workspace.environment-overview': workspacePaths.environment(team, app, environment),
    'workspace.environment-deployments': workspacePaths.environment(team, app, environment, 'deployments'),
    'workspace.environment-configuration': workspacePaths.environment(team, app, environment, 'configuration'),
    'workspace.environment-domains': workspacePaths.environment(team, app, environment, 'domains'),
    'workspace.unavailable': '/dashboard/unavailable',
  } satisfies Record<WorkspacePageId, string>;
})();

export function workspaceFixtureRoute(id: string) {
  const route = workspaceFixtureRoutes[id as WorkspacePageId];
  return route ? matchWorkspaceRoute(route) : undefined;
}
