import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import { teamSectionLinks, type teamSections } from './routes.ts';
import { SectionNav } from './section-nav.tsx';

export function TeamTabs({ team, current }: { team: TeamWithRole; current?: keyof typeof teamSections }): React.ReactElement {
  return <SectionNav label="Team workspace pages" mode="tabs" links={teamSectionLinks(team, current)} />;
}
