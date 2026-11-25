import * as React from 'react';
import type { z } from 'zod';
import { InstanceRowSchema } from './props.ts';
import type { ObservedAt } from '../sdk/transport.ts';
import { instanceRow } from './instance-row.tsx';

/**
 * The `ul` on its own, so the polite announcement is attached to the region that changes rather than to the
 * heading and the explanation beside it. A whole `section` marked `aria-live` announces its own title.
 */
export function RowList(props: {
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
