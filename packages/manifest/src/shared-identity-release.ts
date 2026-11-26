import { parseCompose, renderProdOverlay } from './compose.ts';
import { applyInventory, parseInventory, validateInventory } from './inventory.ts';
import type { RepositorySource } from './template-catalog.ts';

const keycloak = 'keycloak';
export const identityBootstrapSetting = 'KC_BOOTSTRAP_ADMIN_PASSWORD';

export function validateIdentitySource(source: RepositorySource, version: string, image: string) {
  const [taggedImage, digest] = image.split('@') as [string, string];
  const [repository, tag] = taggedImage.split(':') as [string, string];
  const parsed = parseCompose([source.compose, renderProdOverlay(source.compose, { [keycloak]: { image: repository, tag, digest } })]);
  const inventory = parseInventory(source.inventory ?? '');
  if (!parsed.manifest || parsed.issues.length || inventory.issues.length || validateInventory(inventory.entries, parsed.manifest).length) {
    throw new Error('The pinned identity release has an invalid platform manifest');
  }
  const manifest = applyInventory(parsed.manifest, inventory.entries);
  const database = manifest.spec.resources.database;
  const service = manifest.spec.services[keycloak];
  if (manifest.metadata.name !== 'shared-identity' || manifest.metadata.version !== version || manifest.metadata.mode !== 'hosted' ||
      !service?.public || service.image !== taggedImage || service.digest !== digest || !service.start || database?.kind !== 'postgres' ||
      service.references.some((ref) => ref.database !== database.name || !ref.output) ||
      !service.secrets.some(({ name }) => name === identityBootstrapSetting)) {
    throw new Error('Unexpected identity release topology');
  }
  return { database, service };
}
