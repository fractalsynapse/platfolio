import { WORKSPACE_SCREENS } from './workspace.ts';
import { STARTER_LAUNCH_SCREEN } from './starter-launch.tsx';
import { INSTANCE_LIST_SCREEN } from './instance-list.tsx';
import type { ScreenDocument } from './screen.ts';

export * from './screen.ts';

/**
 * Every screen this package ships. A closed table, for the same reason the component registry is one (D13, D14,
 * gate §9.6): a gate that walks the screens has to be handed the list by the package that owns them, and a
 * document fetched at run time is not a screen, it is a remote code loader with better documentation.
 *
 * Each addition to the table is checked separately for §9.11 capability parity.
 */
export const SCREENS = [INSTANCE_LIST_SCREEN, STARTER_LAUNCH_SCREEN, ...WORKSPACE_SCREENS] as const satisfies readonly ScreenDocument[];

export { INSTANCE_LIST_SCREEN };
export { InstanceListScreen } from './instance-list.tsx';

export { StarterLaunchScreen } from './starter-launch.tsx';
