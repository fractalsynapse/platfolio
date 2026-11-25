import * as React from 'react';
import { WorkspaceContent } from './workspace-content.tsx';
import { WorkspaceNavigationContext, type WorkspaceNavigation } from './navigation.ts';

export function Workspace(navigation: WorkspaceNavigation) {
  const main = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { main.current?.focus({ preventScroll: true }); }, [navigation.pathname]);
  return <WorkspaceNavigationContext.Provider value={navigation}>
    <a href="#workspace-content" className="ui-workspace-skip">Skip to content</a>
    <div className="ui-workspace" ref={main} tabIndex={-1}>
      <WorkspaceContent />
    </div>
  </WorkspaceNavigationContext.Provider>;
}
