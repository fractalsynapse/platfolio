import { freshnessLabel } from './freshness-display.tsx';
import { instanceState } from './instance-state-display.tsx';
import { instanceRow } from './instance-row.tsx';
import { instanceList } from './instance-list.tsx';
import { instanceDetail } from './instance-detail.tsx';
import { contextSwitcher } from './context-switcher.tsx';

export * from './freshness-display.tsx';
export * from './instance-state-display.tsx';
export * from './instance-row.tsx';
export * from './instance-list.tsx';
export * from './instance-detail.tsx';
export * from './context-switcher.tsx';

export const INSTANCE_COMPONENTS = [
  freshnessLabel, instanceState, instanceRow, instanceList, instanceDetail, contextSwitcher,
] as const;
