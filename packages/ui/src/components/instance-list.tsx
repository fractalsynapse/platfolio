import * as React from 'react';
import { z } from 'zod';
import { defineComponent, type ComponentContract } from '../contract.ts';
import { useSignalValue } from '../signals-context.ts';
import { InstanceRowSchema, TeamOptionSchema } from './props.ts';
import { RowList } from './row-list.tsx';

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
  render: (props: InstanceListProps): React.ReactNode => {
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
