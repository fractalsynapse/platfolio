import * as React from 'react';
import { useOperation } from '../sdk/use-operation.ts';
import { isLoaded } from '../sdk/transport.ts';
import { useSignalValue } from '../signals-context.ts';
import { renderScreen } from './screen.ts';
import type { ScreenDocument } from './screen.ts';
import type { Freshness, State } from '../sdk/transport.ts';
import type { OperationId } from '@platfolio/api-contract/generated/types';
import type { InstanceResponse, TeamWithRole } from '@platfolio/api-contract/generated/types';

/**
 * The instance list, as a screen document and the one container that reads it.
 *
 * ## The composition, and why it is data
 *
 * 11 §2 gives the floor case and the wide case as one design: `split` is master and detail when the container has
 * room, and below its threshold the same content is a column with the detail pushed as a sheet. `PRIMITIVES` says
 * that in `wideFromRem` and `floorSlots`; this document says which components sit in which slot. Gate §9.11 then
 * compares the operations reachable at each width by walking *this object*, which is the only way 11 §2 acceptance
 * (d) can be a gate rather than an impression: had the layout lived in the container's JSX there would have been
 * nothing to walk, and the honest report would have been NOT RUN forever.
 *
 * `instance.detail` appears twice, once in the wide detail track and once as the pushed sheet. That is not a fork:
 * it is one component with the two homes rule 2 describes ("same component, one contract, three homes"), and the
 * document is what makes the claim checkable -- §9.11 refuses it if the component's own `slots` list does not cover
 * both.
 *
 * ## What the container is allowed to be
 *
 * Data arrives through the SDK hook layer (11 §1's second sanctioned door), context arrives from the signal
 * registry, and nothing here owns a timer, a URL or a transport (gates §9.2, §9.10). Every branch of `State<O>` is
 * rendered: `pending` says the request is outstanding, `failed` says what the control plane answered, and a failed
 * *refresh* keeps the rows that already arrived at their original age -- that is `applyResult`'s rule, not a
 * decision made in a screen. R10 asks "delete the server: what does the screen show?", and the answer here is
 * last-known-with-an-age or an explicit refusal, never a spinner that waits forever and never a success that was
 * not granted.
 */
export const INSTANCE_LIST_SCREEN: ScreenDocument = {
  id: 'screen.instance-list',
  title: 'Instances',
  root: {
    slot: 'full-page',
    components: ['freshness.label'],
    children: [
      {
        slot: 'split',
        children: [
          // The master track: one column holding the context selector and the list. `stack` is the floor home for
          // both, which is what makes the same two components reachable at 360 px.
          { slot: 'stack', components: ['context.switcher', 'instance.list'] },
          // The detail track, which at the floor width is the pushed sheet below instead.
          { slot: 'popout-sidebar', components: ['instance.detail'] },
        ],
      },
      { slot: 'overlay-sheet', components: ['instance.detail'] },
    ],
  },
};

export interface InstanceListScreenProps {
  /**
   * The instant this render speaks about. Injected rather than read from a clock, because a render that calls
   * `Date.now()` inside itself makes the same props mean two things depending on when they were composed, and a
   * fixture could then assert nothing. The shell's clock is the same one the SDK stamps `observedAt` with (see
   * `useClock`), so both ends of an age label agree.
   */
  readonly now: string;
}

/**
 * The container. It renders the document and supplies props out of the SDK's answers.
 *
 * `getLatestAttestation` is only *asked* when the context names an instance: the path parameter is required, and a
 * request built with an empty id comes back as the transport's own `invalid_request` refusal -- which a detail pane
 * would then have to report as "nothing has reported for this instance", a sentence about a question that was never
 * asked. So the un-asked case is passed as `null`, and `instance.detail` renders that as its own state with its own
 * words.
 */
export function InstanceListScreen(props: InstanceListScreenProps): React.ReactElement {
  const params = React.useMemo(() => ({}), []);
  const instances = useOperation('listInstances', { params });
  const teams = useOperation('listTeams', { params });
  const context = useSignalValue('context.switched');
  const selectedInstanceId = context?.instanceId ?? null;
  const attestationParams = React.useMemo(() => ({ instanceId: selectedInstanceId ?? '' }), [selectedInstanceId]);
  const attestation = useOperation('getLatestAttestation', { params: attestationParams });

  const rows: readonly InstanceResponse[] = isLoaded(instances.state) ? instances.state.data : [];
  const teamRows: readonly TeamWithRole[] = isLoaded(teams.state) ? teams.state.data : [];
  const selected = rows.find((row) => row.id === selectedInstanceId) ?? null;
  const latest = selectedInstanceId !== null && isLoaded(attestation.state) ? attestation.state.data : null;

  return (
    <>
      {renderScreen(INSTANCE_LIST_SCREEN, (componentId) => {
        switch (componentId) {
          case 'freshness.label':
            return { freshness: freshnessOf(instances.state), now: props.now, describes: 'Instances' };
          case 'context.switcher':
            return { teams: teamRows, instances: rows };
          case 'instance.list':
            return { instances: rows, teams: teamRows, observedAt: observedAtOf(instances.state), now: props.now };
          case 'instance.detail':
            return { instance: selected, attestation: latest, freshness: freshnessOf(attestation.state), now: props.now };
          default:
            // `instance.row` and `instance.state` are rendered by the list, not placed by the document, so they
            // never reach here. The throw stays, because "no props for a placement the document names" is the
            // failure a screen must not answer with an empty element (11 §9.5).
            throw new TypeError(`InstanceListScreen has no props for ${componentId}`);
        }
      })}
      {/* The two branches a document cannot carry, because they are about the *ask* rather than the arrangement. */}
      {instances.state.status === 'pending'
        ? <p role="status">{`Asking the control plane for instances (waiting since ${instances.state.since}).`}</p>
        : null}
      {instances.state.status === 'failed'
        ? <p role="status">{`The control plane refused: ${instances.state.error.message} (${instances.state.error.code}). ${rows.length === 0 ? 'There is no earlier answer to show.' : 'Still showing the last answer that arrived, at its own age.'}`}</p>
        : null}
      {attestation.state.status === 'failed' && selectedInstanceId !== null
        ? <p role="status">{`No run has reported for this instance: ${attestation.state.error.code}.`}</p>
        : null}
    </>
  );
}

/** The instant this state was observed, whatever its branch. `pending` has only the moment the ask began. */
function observedAtOf(state: { readonly status: 'pending'; readonly since: string } | { readonly status: 'loaded' | 'failed'; readonly freshness: Freshness }): string {
  return state.status === 'pending' ? state.since : state.freshness.observedAt;
}

/**
 * The freshness fact for a label, without inventing one.
 *
 * `pending` has no observation, so it carries the moment the ask began and the kind of driver that will produce the
 * answer -- the same `via` the SDK stamps when it settles, and not a claim that anything has been observed yet. The
 * words that say so belong to the branch rendering them, and `test/screens.test.ts` asserts both.
 */
/**
 * Generic in the operation, because `State<O>` is *invariant* in `O`: `data: SuccessOf<O>` sits in both a
 * covariant and a contravariant position, so `State<'listInstances'>` is not a `State<OperationId>` and a helper
 * typed on the wide union refuses every real answer. Widening the parameter to `OperationId` would have been a
 * lie about what it accepts.
 */
function freshnessOf<O extends OperationId>(state: State<O>): { observedAt: string; via: 'poll' | 'events' } {
  return state.status === 'pending'
    ? { observedAt: state.since, via: 'poll' }
    : { observedAt: state.freshness.observedAt, via: state.freshness.via };
}
