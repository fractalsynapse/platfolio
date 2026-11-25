import * as React from 'react';
import { z } from 'zod';
import { defineComponent, type ComponentContract } from '../contract.ts';
import { ROLLUP_IS_NOT_THE_TRUTH, statePresentation } from './instance-state.ts';
import { InstanceRowSchema } from './props.ts';
import { ageLabel } from './freshness.ts';

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
  render: (props: InstanceStateProps): React.ReactNode => {
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
