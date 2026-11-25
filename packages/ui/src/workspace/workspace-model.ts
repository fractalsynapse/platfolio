import * as React from 'react';
import type { TeamWithRole } from '@platfolio/api-contract/generated/types';
import type { Loaded, UseOperationResult } from '../sdk/use-operation.ts';
import type { WorkspaceRoute } from './routes.ts';

export const WORKSPACE_READS = ['listTeams', 'listMyInvitations', 'getAccountProfile'] as const;

interface WorkspaceModel {
  readonly route: WorkspaceRoute;
  readonly teams: Loaded<'listTeams'>;
  readonly team: TeamWithRole | undefined;
  readonly reloadTeams: () => void;
  readonly invitations: UseOperationResult<'listMyInvitations'>;
  readonly profile: UseOperationResult<'getAccountProfile'>;
}

export const WorkspaceModelContext = React.createContext<WorkspaceModel | null>(null);

export function useWorkspaceModel(): WorkspaceModel {
  const model = React.useContext(WorkspaceModelContext);
  if (!model) throw new Error('A workspace page needs the workspace shell');
  return model;
}

export function useWorkspaceTeam(): TeamWithRole {
  const { team } = useWorkspaceModel();
  if (!team) throw new Error('The workspace page requires a selected team');
  return team;
}
