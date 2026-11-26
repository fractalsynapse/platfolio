import { parse as parseYaml } from 'yaml';
import { parseInventory } from './inventory.ts';
import { FREE_STARTER_RELEASE as listing } from './template-catalog.ts';

export function validateStarterSource(composeText: string, inventoryText: string | undefined, version: string = listing.version) {
  // This uses Railway's source builder. An image-based InfraPlan is only valid after an artifact is published.
  const compose = parseYaml(composeText) as { services?: Record<string, { build?: { dockerfile?: string } }>; 'x-platfolio'?: { metadata?: { name?: string; version?: string }; resources?: { database?: { kind?: string } } } };
  const metadata = compose['x-platfolio']?.metadata;
  const inventory = parseInventory(inventoryText ?? '');
  const database = inventory.entries.find((variable) => variable.name === 'DATABASE_URL');
  if (metadata?.name !== listing.template || metadata.version !== version || compose.services?.web?.build?.dockerfile !== 'Dockerfile' ||
      compose['x-platfolio']?.resources?.database?.kind !== 'postgres' || inventory.issues.length || database?.kind !== 'reference' ||
      database.service !== 'web' || database.database !== 'app-db' || database.output !== 'DATABASE_URL') {
    throw new Error('Pinned starter does not match the reviewed source-build and database placement');
  }
  return inventory.entries;
}
