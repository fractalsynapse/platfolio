import * as React from 'react';

const dayLength = 86_400_000;
const dayCount = 14;
const dateLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function ActivityHistory({ timestamps, now, noun, tone }: {
  readonly timestamps: readonly string[];
  readonly now: Date;
  readonly noun: string;
  readonly tone: 'success' | 'attention';
}): React.ReactElement {
  const start = Math.floor(now.getTime() / dayLength) - dayCount + 1;
  const counts = new Map<number, number>();
  for (const timestamp of timestamps) {
    const day = Math.floor(Date.parse(timestamp) / dayLength);
    if (day >= start && day < start + dayCount) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
  return <div>
    <p className="ui-workspace-meta"><strong>{total}</strong> {noun} in the last {dayCount} days</p>
    <div className="ui-activity-history">
      <ol className="ui-activity-bars" aria-label={`${noun} by day (UTC)`}>
        {Array.from({ length: dayCount }, (_, index) => {
          const day = start + index;
          const count = counts.get(day) ?? 0;
          const label = `${dateLabel.format(day * dayLength)}: ${count}`;
          return <li key={day} title={label} data-tone={count ? tone : undefined}
            style={{ '--ui-activity-level': Math.min(count, 4) } as React.CSSProperties}>
            <span className="ui-sr-only">{label}</span>
          </li>;
        })}
      </ol>
      <div className="ui-workspace-meta ui-activity-range" aria-hidden="true">
        <span>{dateLabel.format(start * dayLength)}</span><span>{dateLabel.format(now)} · UTC</span>
      </div>
    </div>
  </div>;
}
