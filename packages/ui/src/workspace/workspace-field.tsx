import * as React from 'react';
import type { ReactNode } from 'react';

export function WorkspaceField({ id, label, children }: { readonly id: string; readonly label: ReactNode; readonly children: ReactNode }): React.ReactElement {
  return <><label htmlFor={id}>{label}</label>{children}</>;
}
