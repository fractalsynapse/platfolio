import * as React from 'react';
import type { ComponentPropsWithRef } from 'react';

type Variant = 'primary' | 'secondary' | 'trigger' | 'menu' | 'plain';

export function WorkspaceAction({ variant = 'trigger', className, type = 'button', ...props }: ComponentPropsWithRef<'button'> & {
  variant?: Variant;
}): React.ReactElement {
  const style = variant === 'menu' ? 'ui-workspace-item' : variant === 'plain' ? '' : `ui-workspace-${variant}`;
  return <button {...props} type={type} className={[style, 'ui-hit-primary', className].filter(Boolean).join(' ')} />;
}
