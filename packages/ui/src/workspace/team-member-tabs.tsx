import * as React from 'react';
import { workspacePaths } from './routes.ts';
import { SectionNav } from './section-nav.tsx';

export function TeamMemberTabs({ team, current }: { team: string; current: 'roster' | 'invitations' }): React.ReactElement {
  return <SectionNav label="Team sections" links={[
    { href: workspacePaths.teamMembers(team), label: 'Members', current: current === 'roster' },
    { href: workspacePaths.teamInvitations(team), label: 'Invitations', current: current === 'invitations' },
  ]} />;
}
