import type { SuccessOf } from '@platfolio/api-contract/generated/types';

export type StarterLaunchReport = SuccessOf<'getStarterLaunch'>;
export type StarterLaunchEvent = StarterLaunchReport['events'][number];
export type StarterRemoval = 'keep' | 'wipe';

/** Present only on the customer's installation with an explicitly connected local runner. */
export interface StarterLaunch {
  readonly teamId: string;
  read(): StarterLaunchReport;
  start(): StarterLaunchReport;
  remove(data: StarterRemoval): StarterLaunchReport;
}
