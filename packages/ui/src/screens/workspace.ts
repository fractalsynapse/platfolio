import type { ScreenDocument } from './screen.ts';

export const WORKSPACE_SCREEN: ScreenDocument = {
  id: 'screen.workspace',
  title: 'Workspace',
  root: { slot: 'full-page', components: ['workspace.content'] },
};
