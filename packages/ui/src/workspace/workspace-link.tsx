import * as React from 'react';
import { workspaceReturnPath } from './routes.ts';
import { WorkspaceNavigationContext } from './navigation.ts';

/** A real link preserves copy, new-tab, and fallback navigation. */
export function WorkspaceLink({ href, onClick, ...props }: React.ComponentProps<'a'>) {
  const navigation = React.useContext(WorkspaceNavigationContext);
  return <a {...props} href={href} onClick={(event) => {
    onClick?.(event);
    if (!navigation || !href || !workspaceReturnPath(href) || event.defaultPrevented || props.target || event.button !== 0 ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    navigation.navigate(href);
  }} />;
}
