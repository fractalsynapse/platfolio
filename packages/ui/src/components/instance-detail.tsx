import * as React from 'react';
import { z } from 'zod';
import { defineComponent, type ComponentContract } from '../contract.ts';
import { useSignalValue } from '../signals-context.ts';
import { AttestationBriefSchema, AttestationReleaseSchema, FreshnessSchema, InstanceDetailSchema, fieldLabel } from './props.ts';
import { ageLabel } from './freshness.ts';
import { instanceState } from './instance-state-display.tsx';
import { Field } from './detail-field.tsx';

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
  render: (props: InstanceDetailProps): React.ReactNode => {
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
