import * as React from 'react';
import { renderScreen } from '../screens/screen.ts';
import { WORKSPACE_SCREEN } from '../screens/workspace.ts';
import { WorkspaceNavigationContext, type WorkspaceNavigation } from './navigation.ts';

export function Workspace(navigation: WorkspaceNavigation) {
  const main = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { main.current?.focus({ preventScroll: true }); }, [navigation.pathname]);
  return <WorkspaceNavigationContext.Provider value={navigation}>
    <a href="#workspace-content" className="ui-workspace-skip">Skip to content</a>
    <div className="ui-workspace" ref={main} tabIndex={-1}>
      {renderScreen(WORKSPACE_SCREEN, () => ({}))}
    </div>
  </WorkspaceNavigationContext.Provider>;
}
