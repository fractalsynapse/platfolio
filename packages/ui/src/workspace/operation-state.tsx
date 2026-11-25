import * as React from 'react';
import type { ReactNode } from 'react';
import { WorkspaceAction } from './workspace-action.tsx';

export function OperationState({ status, pending, failed, retry, retryLabel = 'Try again', children }: {
  readonly status: 'pending' | 'failed' | 'loaded';
  readonly pending: string;
  readonly failed: ReactNode;
  readonly retry?: (() => void) | undefined;
  readonly retryLabel?: string;
  readonly children?: ReactNode;
}): React.ReactElement {
  if (status === 'pending') return <p role="status">{pending}</p>;
  if (status === 'failed') return <div role="status">{failed}{retry && <> <WorkspaceAction onClick={retry}>{retryLabel}</WorkspaceAction></>}</div>;
  return <>{children}</>;
}
