import * as React from 'react';
import type { ReactNode } from 'react';
import { CONTENT_TABLE } from './content.ts';

export function MainContext({ children }: { readonly children: ReactNode }): React.ReactElement {
  return <div className={CONTENT_TABLE.columns.className} data-columns="main-context">{children}</div>;
}
