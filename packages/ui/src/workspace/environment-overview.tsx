import * as React from 'react';
import type { InstanceResponse } from '@platfolio/api-contract/generated/types';
import { instanceState } from '../components/instances.ts';
import type { Freshness } from '../sdk/transport.ts';

const StateLabel = instanceState.render;

interface EnvironmentOverviewProps {
  readonly environment: InstanceResponse['environments'][number];
  readonly freshness: Freshness;
  readonly now: string;
}

export function EnvironmentOverview({ environment, freshness, now }: EnvironmentOverviewProps): React.ReactElement {
  return <dl className="ui-workspace-facts" aria-label="Environment details">
    <div><dt>Last reported state</dt><dd><StateLabel environment={environment.environment} state={environment.state} observedAt={freshness.observedAt} now={now} /></dd></div>
    <div><dt>Last report</dt><dd><time dateTime={environment.updatedAt}>{environment.updatedAt}</time></dd></div>
    {environment.appliedPlanHash && <div><dt>Applied plan</dt><dd><code>{environment.appliedPlanHash}</code></dd></div>}
  </dl>;
}
