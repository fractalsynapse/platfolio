import * as React from 'react';
import { z } from 'zod';
import { defineComponent, type ComponentContract } from '../contract.ts';
import { FreshnessSchema } from './props.ts';
import { ageLabel } from './freshness.ts';
import { STALE_SUFFIX } from './copy.ts';

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
  render: (props: FreshnessLabelProps): React.ReactNode => {
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
