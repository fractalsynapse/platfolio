import * as React from 'react';
import { z } from 'zod';
import { defineComponent, type ComponentContract } from '../contract.ts';
import { InstanceRowSchema } from './props.ts';
import { instanceState } from './instance-state-display.tsx';

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
  render: (props: InstanceRowProps): React.ReactNode => {
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
