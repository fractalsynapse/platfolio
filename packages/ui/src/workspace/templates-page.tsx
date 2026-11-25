import * as React from 'react';
import { FreeTemplatePicker } from './free-template-picker.tsx';
import { TeamTabs } from './team-tabs.tsx';
import { WorkspaceHeading } from './workspace-heading.tsx';
import { useWorkspaceTeam } from './workspace-model.ts';

export function TemplatesPage(): React.ReactElement {
  const team = useWorkspaceTeam();
  return <>
    <WorkspaceHeading title="Choose template" />
    <TeamTabs team={team} current="templates" />
    <FreeTemplatePicker team={team.name} />
  </>;
}
