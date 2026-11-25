import * as React from 'react';
import { ActivityFeed } from './activity-feed.tsx';

const labels: Record<string, string> = { WORKING: 'Working', READY: 'Complete', SUCCESS: 'Complete', FAILED: 'Needs attention' };

export function LaunchProgress({ report }: { readonly report: {
  readonly events: readonly { at: string; step: string; state: string; detail?: string }[];
} }): React.ReactElement | null {
  if (!report.events.length) return null;
  const entries = report.events.map((event, index) => ({
    id: event.at + '-' + index, at: event.at, title: event.step,
    detail: [labels[event.state] ?? event.state.toLowerCase(), event.detail].filter(Boolean).join(' · '),
  }));
  const download = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 2));
  return <>
    <ActivityFeed title="Setup progress" empty="Setup hasn’t started." entries={entries} />
    <p><a download="platfolio-launch-report.json" href={download}>Download troubleshooting report</a></p>
  </>;
}
