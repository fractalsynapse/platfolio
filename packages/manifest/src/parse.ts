import { parse as parseYaml } from 'yaml';
import { ManifestSchema, type Manifest } from './schema.ts';
import { validateManifest, type Issue } from './validate.ts';

export interface Parsed {
  manifest?: Manifest;
  issues: Issue[];
}

/**
 * One entry point for YAML text: parse, schema-validate, semantic-validate. Never throws.
 *
 * Returns zod's *output*, not the raw document: the raw form lacks defaulted fields, and a renderer
 * that reads `spec.services[x].domains` off an un-defaulted object fails at render time instead of
 * here. Validating and then discarding the coerced value is the bug this guards against.
 */
export function parse(text: string): Parsed {
  let doc: unknown;
  try {
    doc = parseYaml(text, { uniqueKeys: true });
  } catch (error) {
    return { issues: [{ path: '(document)', code: 'yaml-parse', message: (error as Error).message }] };
  }
  const issues = validateManifest(doc);
  if (issues.length > 0) return { issues };
  const result = ManifestSchema.safeParse(doc);
  if (!result.success) {
    return { issues: result.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', code: 'schema', message: i.message })) };
  }
  return { manifest: result.data, issues: [] };
}
