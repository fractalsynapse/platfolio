import { INSTANCE_LIST_SCREEN } from './instance-list.tsx';
import type { ScreenDocument } from './screen.ts';

export * from './screen.ts';

/**
 * Every screen this package ships. A closed table, for the same reason the component registry is one (D13, D14,
 * gate §9.6): a gate that walks the screens has to be handed the list by the package that owns them, and a
 * document fetched at run time is not a screen, it is a remote code loader with better documentation.
 *
 * One entry. `context.switcher` and `instance.detail` exist because this screen places them; nothing else does.
 * A second screen is an addition to this table, which puts the composition in a diff where §9.11's parity claim
 * can be reviewed per screen rather than assumed globally.
 */
export const SCREENS = [INSTANCE_LIST_SCREEN] as const satisfies readonly ScreenDocument[];

export { INSTANCE_LIST_SCREEN };
export { InstanceListScreen } from './instance-list.tsx';
