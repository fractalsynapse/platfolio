import * as React from 'react';
import type { ReactNode } from 'react';
import { CONTENT_TABLE } from './content.ts';

export function MainContext({ children, contextFirst = false }: {
  readonly children: ReactNode;
  readonly contextFirst?: boolean;
}): React.ReactElement {
  return <div className={CONTENT_TABLE.columns.className} data-columns="main-context"
    data-context-first={contextFirst ? '' : undefined}>{children}</div>;
}
