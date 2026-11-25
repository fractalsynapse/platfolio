import * as React from 'react';
import { z } from 'zod';
import { defineComponent, type ComponentContract } from '../contract.ts';
import { useEmit, useSignalValue } from '../signals-context.ts';
import { EnvironmentStateSchema, InstanceRowSchema, TeamOptionSchema, fieldLabel } from './props.ts';
import { isSelectableEnvironment, SELECTABLE_ENVIRONMENTS } from './enums.ts';

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
