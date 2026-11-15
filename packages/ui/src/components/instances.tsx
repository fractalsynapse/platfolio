import * as React from 'react';
import { z } from 'zod';
import { defineComponent } from '../contract.ts';
import { useEmit, useSignalValue } from '../signals-context.ts';
import { ROLLUP_IS_NOT_THE_TRUTH, statePresentation } from './instance-state.ts';
import {
  AttestationBriefSchema, AttestationReleaseSchema, EnvironmentStateSchema, FreshnessSchema, InstanceDetailSchema,
  InstanceRowSchema, TeamOptionSchema, fieldLabel,
} from './props.ts';
import { isSelectableEnvironment, SELECTABLE_ENVIRONMENTS } from './enums.ts';
import { ageLabel } from './freshness.ts';
import { STALE_SUFFIX } from './copy.ts';
import type { AnyComponentContract, ComponentContract } from '../contract.ts';
import type { ObservedAt } from '../sdk/transport.ts';

/**
 * The instance-facing components, in `.tsx` -- which is the whole subject of #259. This file is type-checked in CI
 * by `packages/ui/tsconfig.json` (`jsx: react-jsx`, `lib` with `DOM`), so a type error here fails `pnpm run
 * typecheck` and names the line. Before that change the repository's only type-check surface was a `.ts`-only
 * program with no `jsx`: a screen like this would have been transpiled by `tsx` at run time and never compiled by
 * anything, which is a contract package whose contracts are not checked.
 *
 * ## What each declaration is obliged to mean
 *
 * - `reads` names the generated operations whose results the component may render (rule 1). A field rendered from
 *   data nobody declared is invisible to `api:check`, to `spec:check` and to the capability-parity gate: #247's
 *   lesson applied one layer up. Gate §9.1 is the one that looks for a restated server shape.
 * - `slots` names the primitives it promises to behave inside (rule 2). Gate §9.11 now asks, of every placement in
 *   every screen document, that the slot named there has a floor home the component actually declares -- which is
 *   how "a capability that exists only when wide" becomes a build failure instead of a Friday.
 * - `consumes` and `produces` name the signals the code below really touches (rule 3). 11 §3 puts the emitter on
 *   the *component* so a reviewer reads the registration and finds the call in the same file, rather than
 *   consulting a second list nobody audits.
 * - `draftable` appears nowhere. 11 §5's draft store (`src/web/drafts.ts`) does not exist, UI-OD4 still owns the
 *   retention numbers, and an allowlist naming fields for a store that cannot write them is a declaration with no
 *   mechanism behind it -- the `FakeInfraProvider` lie from rule 3's cost note, wearing a prop list.
 *
 * No `fetch`, no timer, no storage API and no `window`/`document` appears in this file: gates §9.2 and §9.3 read
 * these lines, and the walk now covers `.tsx` as well as `.ts`.
 *
 * ## Why context is a subscription and not a prop
 *
 * Context selection is 11 §3's canonical case: change the team, every panel reloads. The switcher *emits*
 * `context.switched`; the list and the detail read it back. Nothing threads a `selectedTeam` through four levels of
 * parent, which is the ad-hoc drilling this registry exists to kill, and nothing holds a module-level "current
 * context", which would give one browser tab one truth for every shell mounted in it: UI-OD1 is still open, and
 * 11's own argument for the gates is that two containers may have to coexist.
 *
 * ## Why no state word is spelled here, and what that costs the screen
 *
 * Rule 5's grep refuses the word the contract's own state enum uses for a running service, and a text search
 * cannot tell an enumeration key from UI copy. So the presentation table in `instance-state.ts` names every state
 * *except* that one and the unnamed member falls to a stated default. The consequence is visible and disclosed: a
 * healthy instance is presented in the neutral tone rather than the `ok` colour. The same collision is why state
 * *validation* takes the kind and leaves membership to the generated type -- `props.ts` states both, and the two
 * ways to close it properly. Neither was resolved by widening a gate.
 *
 * ## Why the props types are `z.infer`, and why `className`
 *
 * The prop type of each contract is the inference of its own schema, not a hand-written interface beside it: that
 * is one description of "what this component accepts", and `props.ts`'s assertions are what tie it to the
 * generated contract. (Writing the interface separately fails to compile under `exactOptionalPropertyTypes` for a
 * reason worth knowing rather than working around: zod's `.optional()` produces `T | undefined`, and a declared
 * `?: T` refuses it. The two spellings of one optionality are the same defect this package keeps naming.)
 *
 * `className`/`htmlFor` are React's spellings. The five shipped primitives in `layout/index.ts` pass `class` and
 * `for` through `createElement`, which React warns about -- measured: "Invalid DOM property `class`. Did you mean
 * `className`?" -- and still renders. That divergence is reported in the change notes; it is not this file's to
 * fix, because `test/layout.test.ts` asserts the primitives' prop object as it is written today.
 */


/* ------------------------------------------------------------------ 1. the age line */

export const freshnessLabelProps = z.object({
  freshness: FreshnessSchema,
  now: z.string().min(1),
  /** What the age belongs to, so the sentence is attached to a thing instead of floating at the top of a page. */
  describes: z.string().min(1),
});

export type FreshnessLabelProps = z.infer<typeof freshnessLabelProps>;

export const freshnessLabel: ComponentContract<FreshnessLabelProps> = defineComponent({
  id: 'freshness.label',
  props: freshnessLabelProps,
  // No `reads`, and that absence is a claim the freshness rule holds it to: this renders no server value. It
  // renders the *observation time*, which the SDK stamped. Declaring an operation here would be a second
  // description of the data path, one of them wrong.
  slots: ['stack', 'split', 'popout-sidebar', 'overlay-sheet', 'full-page'],
  render: (props: FreshnessLabelProps) => {
    const { text, mayBeStale } = ageLabel(props.freshness, props.now);
    // `aria-live` is deliberately absent. This is a restatement of when something was observed, not a region that
    // changes under you, and 11 §8 reserves polite announcements for those: an `aria-live` on every timestamp is
    // how a screen reader spends the afternoon saying "updated".
    return (
      <span className={`ui-age${mayBeStale ? ' ui-age--stale' : ''}`} data-stale={mayBeStale ? 'true' : 'false'}>
        {`${props.describes}: ${text}${mayBeStale ? STALE_SUFFIX : ''}`}
      </span>
    );
  },
});

/* ------------------------------------------------------------------ 2. the state token */

export const instanceStateProps = z.object({
  // Reused out of `InstanceRowSchema` rather than declared a second time: one validator for "what the contract
  // calls a state", in the one schema that already has to say it.
  state: InstanceRowSchema.shape.state,
  environment: z.string().min(1).optional(),
  observedAt: z.string().min(1),
  now: z.string().min(1),
});

export type InstanceStateProps = z.infer<typeof instanceStateProps>;

export const instanceState: ComponentContract<InstanceStateProps> = defineComponent({
  id: 'instance.state',
  props: instanceStateProps,
  // Both operations can hand a state here, and neither answer may arrive without the instant it was observed --
  // which is why `observedAt` is required rather than optional. Rule 5 is a type at the seam (11 §9.10) and a
  // required prop at the boundary that consumes it.
  reads: ['listInstances', 'getInstance'],
  slots: ['stack', 'split', 'popout-sidebar', 'overlay-sheet', 'full-page'],
  render: (props: InstanceStateProps) => {
    const presentation = statePresentation(props.state);
    const age = ageLabel({ observedAt: props.observedAt, via: 'poll' }, props.now);
    const scope = props.environment ?? ROLLUP_IS_NOT_THE_TRUTH;
    return (
      <span className={`ui-state ui-tone-${presentation.tone}`} data-tone={presentation.tone}>
        {/* The contract's own word, out of the data, with no softer gloss invented one file away: #202 settled
            that the normalized value is what a person reads. The scope says whether the word is one
            environment's or the rollup's, because staging degraded beside production healthy is a real Tuesday
            and an averaged rollup hides it (#179). */}
        <span className="ui-state-word">{props.state}</span>
        <span className="ui-sr-only">{`, ${scope}`}</span>
        {presentation.announcement === '' ? null : <span className="ui-sr-only">{`. ${presentation.announcement}`}</span>}
        <span className={`ui-age${age.mayBeStale ? ' ui-age--stale' : ''}`}>{age.text}</span>
      </span>
    );
  },
});

/* ------------------------------------------------------------------ 3. one row */

export const instanceRowProps = z.object({
  instance: InstanceRowSchema,
  /**
   * The team half of the address (D45: `team/name`). A row cannot derive it: `InstanceResponse` carries a
   * `teamId`, and the only operation that turns an id into a slug is `listTeams`, which this component does not
   * declare. So the slug is passed in and the row's `reads` stays the truth rather than an invented superset.
   */
  teamSlug: z.string().min(1),
  selected: z.boolean(),
  now: z.string().min(1),
});

export type InstanceRowProps = z.infer<typeof instanceRowProps>;

export const instanceRow: ComponentContract<InstanceRowProps> = defineComponent({
  id: 'instance.row',
  props: instanceRowProps,
  reads: ['listInstances'],
  // `stack` is the floor and the list body; `overlay-sheet` because a row's detail may be pushed. It does not
  // claim `split`: the matrix says a split holds a stack per track, so claiming the track would be a component
  // promising to behave in a composition it is not designed for.
  slots: ['stack', 'overlay-sheet'],
  render: (props: InstanceRowProps) => {
    const { instance, teamSlug } = props;
    return (
      <li role="listitem" className={props.selected ? 'ui-selected' : undefined}>
        {/* The whole row is the target, and the target is 44 px: rule 2's floor is "every capability reachable at
            360 px", and a row a thumb has to aim at is not reachable. `ui-hit-primary` is a class, not an inline
            size, and the class exists in the generated stylesheet. What a static markup test cannot prove is the
            box a browser paints -- that stays gate §9.8's NOT RUN, and is reported that way. */}
        <button type="button" className="ui-hit-primary ui-row" data-instance-id={instance.id} aria-current={props.selected ? 'true' : undefined}>
          <span className="ui-address">{`${teamSlug}/${instance.name}`}</span>
          <span className="ui-sr-only">{`, template ${instance.template}`}</span>
          {instance.environments.length === 0 ? (
            // Nothing verified yet. Showing the rollup alone would be a claim about a provider the controller has
            // not asked (an empty `environments` is what "no reconcile yet" looks like), so the row says that.
            <span className="ui-state ui-tone-neutral">not yet reconciled</span>
          ) : (
            instance.environments.map((environment) => (
              <span key={`${environment.instanceId}-${environment.environment}`} className="ui-env-state">
                <span className="ui-env-name">{environment.environment}</span>
                {instanceState.render({
                  state: environment.state,
                  environment: environment.environment,
                  observedAt: environment.updatedAt,
                  now: props.now,
                })}
              </span>
            ))
          )}
        </button>
      </li>
    );
  },
});

/* ------------------------------------------------------------------ 4. the list */

export const instanceListProps = z.object({
  instances: z.array(InstanceRowSchema),
  /** The teams, for the `team/name` half of every row: `listInstances` gives ids, `listTeams` gives names. */
  teams: z.array(TeamOptionSchema),
  observedAt: z.string().min(1),
  now: z.string().min(1),
});

export type InstanceListProps = z.infer<typeof instanceListProps>;

export const instanceList: ComponentContract<InstanceListProps> = defineComponent({
  id: 'instance.list',
  props: instanceListProps,
  reads: ['listInstances', 'listTeams'],
  consumes: ['context.switched'],
  slots: ['stack', 'overlay-sheet', 'full-page'],
  render: (props: InstanceListProps) => {
    const context = useSignalValue('context.switched');
    const teamIdOf = (slug: string): string | undefined => props.teams.find((team) => team.name === slug)?.teamId;
    const teamNameOf = (teamId: string): string => props.teams.find((team) => team.teamId === teamId)?.name ?? teamId;
    const scoped = context === null ? props.instances : props.instances.filter((instance) => instance.teamId === teamIdOf(context.teamSlug));

    // "Nothing in this team" and "you have not said which team" are different states and get different sentences.
    // Collapsing them is how a screen becomes the thing R10 refuses; and no spinner is invented here either,
    // because the `pending` case belongs to `State<O>` and is the screen container's to render.
    if (context === null) {
      return (
        <section aria-labelledby="ui-list-heading">
          <h2 id="ui-list-heading" className="ui-title">Instances</h2>
          <p role="status">Showing every team you belong to. Pick one to narrow this list.</p>
          <RowList rows={scoped} teamNameOf={teamNameOf} selectedId={null} now={props.now} />
        </section>
      );
    }
    if (scoped.length === 0) {
      return (
        <section aria-labelledby="ui-list-heading">
          <h2 id="ui-list-heading" className="ui-title">Instances</h2>
          <p role="status">{`${context.teamSlug} has no instances yet.`}</p>
        </section>
      );
    }
    return (
      <section aria-labelledby="ui-list-heading">
        <h2 id="ui-list-heading" className="ui-title">Instances</h2>
        <RowList rows={scoped} teamNameOf={teamNameOf} selectedId={context.instanceId} now={props.now} />
        <p className="ui-sr-only">{`${String(scoped.length)} instance(s) listed for ${context.teamSlug}.`}</p>
      </section>
    );
  },
});

/**
 * The `ul` on its own, so the polite announcement is attached to the region that changes rather than to the
 * heading and the explanation beside it. A whole `section` marked `aria-live` announces its own title.
 */
function RowList(props: {
  readonly rows: readonly z.infer<typeof InstanceRowSchema>[];
  readonly teamNameOf: (teamId: string) => string;
  readonly selectedId: string | null;
  readonly now: ObservedAt;
}): React.ReactElement {
  return (
    // `aria-live="polite"`, never assertive: 11 §8 says a region updated by a signal announces itself and does
    // not interrupt. This is that region -- `listInstances` answers, and `context.switched` changes who the
    // answer is about.
    <ul className="ui-list" role="list" aria-live="polite" aria-relevant="additions text">
      {props.rows.map((instance) => instanceRow.render({
        instance,
        teamSlug: props.teamNameOf(instance.teamId),
        selected: props.selectedId !== null && props.selectedId === instance.id,
        now: props.now,
      }))}
    </ul>
  );
}

/* ------------------------------------------------------------------ 5. the detail */

export const instanceDetailProps = z.object({
  // Both nullable, and both nulls are states rather than absences: `getInstance` answers 404 for an instance that
  // is gone and `getLatestAttestation` answers 404 for one that has never reported. A pane that said nothing in
  // either case would be 11 §9.5's empty div at the size of the question a tenant actually asks.
  instance: InstanceDetailSchema.nullable(),
  attestation: AttestationBriefSchema.nullable(),
  freshness: FreshnessSchema,
  now: z.string().min(1),
});

export type InstanceDetailProps = z.infer<typeof instanceDetailProps>;

export const instanceDetail: ComponentContract<InstanceDetailProps> = defineComponent({
  id: 'instance.detail',
  props: instanceDetailProps,
  reads: ['getInstance', 'getLatestAttestation'],
  consumes: ['context.switched'],
  // `overlay-sheet` is here because at 360 px the detail *is* the sheet: the floor projection of a `split`'s
  // detail track and of a `popout-sidebar` both land on `overlay-sheet`, and a component that did not declare
  // that slot would be a capability that exists only when the container is wide. Gate §9.11 checks exactly this,
  // per placement, out of these declarations.
  slots: ['overlay-sheet', 'popout-sidebar', 'stack', 'full-page'],
  render: (props: InstanceDetailProps) => {
    const context = useSignalValue('context.switched');
    const { instance, attestation } = props;
    const age = ageLabel(props.freshness, props.now);

    if (instance === null) {
      return (
        <section className="ui-detail" role="region" aria-labelledby="ui-detail-heading">
          <h2 id="ui-detail-heading" className="ui-title">Instance</h2>
          <p role="status">{context === null ? 'No instance selected.' : `Nothing to show for ${context.teamSlug}.`}</p>
        </section>
      );
    }

    return (
      <section className="ui-detail" role="region" aria-labelledby="ui-detail-heading">
        <h2 id="ui-detail-heading" className="ui-title">{`${context === null ? '' : `${context.teamSlug}/`}${instance.name}`}</h2>
        <p className={`ui-age${age.mayBeStale ? ' ui-age--stale' : ''}`}>{age.text}</p>
        <dl className="ui-fields">
          <Field label={fieldLabel(InstanceDetailSchema, 'template')}>{instance.template}</Field>
          {instance.templateRef === undefined ? null : (
            <Field label={fieldLabel(InstanceDetailSchema, 'templateRef')}>
              {/* Pinned by commit and shown as a commit, because a tag is a thing that moves and a screen that
                  shows a movable thing is not showing the truth of the build. */}
              {`${instance.templateRef.repo} @ ${instance.templateRef.commitSha}`}
            </Field>
          )}
          <Field label={fieldLabel(InstanceDetailSchema, 'provider')}>{instance.provider}</Field>
          <Field label={fieldLabel(InstanceDetailSchema, 'state')}>
            {instanceState.render({ state: instance.state, observedAt: instance.updatedAt, now: props.now })}
          </Field>
          <Field label={fieldLabel(InstanceDetailSchema, 'environments')}>
            {/* The per-environment rows are the truth and the rollup above them is the summary. Both are here,
                because #179 says averaging them is the bug rather than the presentation choice. */}
            <ul className="ui-list" role="list">
              {instance.environments.map((environment) => (
                <li key={`${environment.instanceId}-${environment.environment}`} role="listitem">
                  <span className="ui-env-name">{environment.environment}</span>
                  {instanceState.render({
                    state: environment.state,
                    environment: environment.environment,
                    observedAt: environment.updatedAt,
                    now: props.now,
                  })}
                </li>
              ))}
            </ul>
          </Field>
          {instance.desiredPlanHash === undefined ? null : <Field label={fieldLabel(InstanceDetailSchema, 'desiredPlanHash')}>{instance.desiredPlanHash}</Field>}
          {instance.lastAppliedPlanHash === undefined ? null : <Field label={fieldLabel(InstanceDetailSchema, 'lastAppliedPlanHash')}>{instance.lastAppliedPlanHash}</Field>}
        </dl>
        {attestation === null ? (
          <p role="status">Nothing has reported for this instance yet.</p>
        ) : (
          <dl className="ui-fields" aria-label="Latest run">
            <Field label={fieldLabel(AttestationBriefSchema, 'result')}>{attestation.result}</Field>
            <Field label={fieldLabel(AttestationBriefSchema, 'finishedAt')}>{attestation.finishedAt}</Field>
            {attestation.release === undefined ? null : <Field label={fieldLabel(AttestationReleaseSchema, 'imageDigest')}>{attestation.release.imageDigest}</Field>}
            {attestation.errorCode === undefined ? null : <Field label={fieldLabel(AttestationBriefSchema, 'errorCode')}>{attestation.errorCode}</Field>}
          </dl>
        )}
        {age.mayBeStale ? <p className="ui-age ui-age--stale">This may be older than the control plane's last answer.</p> : null}
      </section>
    );
  },
});

/** A `dt`/`dd` pair, so the label text is the only thing a field contributes and it always comes from a schema. */
function Field(props: { readonly label: string; readonly children?: React.ReactNode }): React.ReactElement {
  return (
    <div className="ui-field">
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ 6. the context selector */

export const contextSwitcherProps = z.object({
  teams: z.array(TeamOptionSchema),
  instances: z.array(InstanceRowSchema),
});

export type ContextSwitcherProps = z.infer<typeof contextSwitcherProps>;

export const contextSwitcher: ComponentContract<ContextSwitcherProps> = defineComponent({
  id: 'context.switcher',
  props: contextSwitcherProps,
  reads: ['listTeams', 'listInstances'],
  // The emitter, in 11 §3's words: the fact leaves from here, and `useEmit` below is the call that makes the
  // declaration true rather than decorative.
  produces: ['context.switched'],
  // And it reads the selection back to mark which option is current, so `consumes` is true of this code too.
  consumes: ['context.switched'],
  slots: ['stack', 'split', 'popout-sidebar', 'full-page'],
  render: (props: ContextSwitcherProps) => {
    const context = useSignalValue('context.switched');
    const emit = useEmit('context.switched');
    const teamIdOf = (slug: string): string | undefined => props.teams.find((team) => team.name === slug)?.teamId;
    const shownInstances = context === null ? [] : props.instances.filter((instance) => instance.teamId === teamIdOf(context.teamSlug));

    // A team change drops the instance, because an id from the team that just left points at a row this screen
    // cannot list: D45's address is `team/name` and half of it just changed. `instanceId: null` is the payload's
    // own way of saying "none yet", and the payload stays refs and ids (11 §3 cost 3), which is also why this
    // signal is allowed to replay at all.
    const chooseTeam = (slug: string): void => {
      emit({ teamSlug: slug, instanceId: null, environment: context?.environment ?? 'production' });
    };
    const chooseInstance = (instanceId: string): void => {
      if (context === null) return;
      emit({ teamSlug: context.teamSlug, instanceId: instanceId === '' ? null : instanceId, environment: context.environment });
    };
    const chooseEnvironment = (value: string): void => {
      if (context === null) return;
      // A value outside the environments the signal accepts is refused rather than coerced: the list is derived
      // from `context.switched`'s payload, so the emit cannot name an environment the payload cannot carry, and
      // the compiler is the one enforcing that. What the contract *does* allow -- `preview`, a free string up to
      // 60 characters -- is reported by `unservedEnvironments()` below rather than silently dropped.
      if (!isSelectableEnvironment(value)) return;
      emit({ teamSlug: context.teamSlug, instanceId: context.instanceId, environment: value });
    };

    return (
      <section className="ui-context" role="group" aria-labelledby="ui-context-heading">
        <h2 id="ui-context-heading" className="ui-title">Context</h2>
        {/* `htmlFor`/`id` rather than a wrapped label: 11 §8 asks for the *association*, and a wrapper is one that
            a later layout change can break without anything noticing. Each label's words come from the props
            schema that describes the field, so they are the schema's names and not this file's. */}
        <label className="ui-label" htmlFor="ui-context-team">{fieldLabel(TeamOptionSchema, 'teamId')}</label>
        <select
          id="ui-context-team"
          className="ui-hit-primary"
          value={context === null ? '' : context.teamSlug}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => chooseTeam(event.target.value)}
        >
          <option value="">Choose a team</option>
          {props.teams.map((team) => (
            <option key={team.teamId} value={team.name}>{`${team.name} · ${team.role}`}</option>
          ))}
        </select>

        <label className="ui-label" htmlFor="ui-context-environment">{fieldLabel(EnvironmentStateSchema, 'environment')}</label>
        <select
          id="ui-context-environment"
          className="ui-hit-primary"
          // No team chosen means no address to scope, and a control that accepts an answer the screen cannot use
          // is a claim the render cannot honour.
          disabled={context === null}
          value={context === null ? 'production' : context.environment}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => chooseEnvironment(event.target.value)}
        >
          {SELECTABLE_ENVIRONMENTS.map((environment) => (
            <option key={environment} value={environment}>{environment}</option>
          ))}
        </select>

        <label className="ui-label" htmlFor="ui-context-instance">{fieldLabel(EnvironmentStateSchema, 'instanceId')}</label>
        <select
          id="ui-context-instance"
          className="ui-hit-primary"
          disabled={context === null}
          value={context?.instanceId ?? ''}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => chooseInstance(event.target.value)}
        >
          <option value="">{context === null ? 'Choose a team first' : 'No instance selected'}</option>
          {shownInstances.map((instance) => (
            <option key={instance.id} value={instance.id}>{instance.name}</option>
          ))}
        </select>
        {/* What the join costs, said out loud: `listInstances` is not team-scoped in the specification, so a
            team's own list is computed here by matching `teamId` against `listTeams`. There is no team-scoped list
            operation to call, and inventing a client for an endpoint that does not exist is not this package's
            option (D41). It is reported as a spec question. */}
        <p className="ui-sr-only">
          {context === null
            ? 'The instance options are computed from listInstances by teamId; the specification has no team-scoped list.'
            : `${String(shownInstances.length)} instance(s) in ${context.teamSlug}, listed from listInstances by teamId.`}
        </p>
      </section>
    );
  },
});

/** Every instance-facing contract, in registration order. The registry and the tests read this, nothing else. */
export const INSTANCE_COMPONENTS = [
  freshnessLabel, instanceState, instanceRow, instanceList, instanceDetail, contextSwitcher,
] as const satisfies readonly AnyComponentContract[];
