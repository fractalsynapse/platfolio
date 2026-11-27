import { parseCompose } from './compose.ts';
import { parseInventory, validateInventory } from './inventory.ts';
import { validateManifest } from './validate.ts';

export function marketplaceBundleManifest(
  recipe: { compose: string; inventory: string },
  images: readonly string[],
  variant: 'shared-service' | 'hosted-application',
) {
  const parsed = parseCompose(recipe.compose);
  const inventory = parseInventory(recipe.inventory);
  if (!parsed.manifest || parsed.issues.length || inventory.issues.length ||
      validateInventory(inventory.entries, parsed.manifest).length ||
      validateManifest(parsed.manifest).some(({ code }) => variant !== 'shared-service' || code !== 'kind-web-unreachable')) {
    throw new Error('Supply a valid deployment recipe and environment registry without inline credentials.');
  }
  const expected = new Set(Object.values(parsed.manifest.spec.services).map(({ image, digest }) => `${image}@${digest}`));
  if (!expected.size || expected.size !== images.length || new Set(images).size !== images.length ||
      images.some((image) => !expected.has(image))) throw new Error('The recipe must use exactly the released image pins.');
  return { manifest: parsed.manifest, inventory: inventory.entries };
}
