import { workspacePageIds, workspacePages } from '../workspace/workspace-pages.ts';

export const WORKSPACE_SCREENS = workspacePageIds.map((id) => workspacePages[id].screen);
