import { createContext } from 'react';

export interface WorkspaceNavigation {
  readonly pathname: string;
  readonly navigate: (path: string) => void;
  readonly signIn: () => void;
  readonly signOut: () => void;
}

export const WorkspaceNavigationContext = createContext<WorkspaceNavigation | null>(null);
