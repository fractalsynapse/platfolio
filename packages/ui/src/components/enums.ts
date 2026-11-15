import { z } from 'zod';
import { SIGNALS } from '../signals.ts';
import type { PayloadOf } from '../signals.ts';

/**
 * The environment half of the context, derived from the signal registry rather than listed beside it (D56: the
 * environment is part of the context, not a detail inside it).
 *
 * The three names are `context.switched`'s payload, so the registry is where they live; spelling them out again
 * in a props schema would be a second description of one fact, and the failure mode of a second description is
 * that it agrees today and drifts tomorrow. `payloadPropertyNames` in `signals.ts` already walks the StandardSchema
 * view of that payload for exactly this kind of question, so this file walks the `enum` arrays in the same view
 * and refuses, at module load, to invent a list when the registry will not show one.
 *
 * **The mismatch this exposes is real and is not smoothed over here.** `InstanceResponse`'s environments are
 * unbounded strings (the store allows 60 characters, and `redeployInstance` accepts `preview`), so a tenant can
 * have an environment the context signal cannot name. `unservedEnvironments()` reports those, the selector says
 * so in the render, and the endpoint question -- is `preview` a context, or is the signal table wrong -- belongs
 * to whoever owns 11 §3 and `openapi.yaml`. It is recorded in the change notes as a spec question under D41.
 */
function enumPropertyOf(schema: unknown, property: string): string[] {
  const std = (schema as { '~standard'?: { jsonSchema?: { input: (o: Record<string, never>) => Record<string, unknown> } } })['~standard'];
  if (typeof std?.jsonSchema?.input !== 'function') {
    throw new TypeError(`enums.ts: the signal payload schema exposes no JSON Schema view, so "${property}" cannot be derived -- refusing to fall back to a hand-written list`);
  }
  const doc = std.jsonSchema.input({});
  const properties = doc.properties as Record<string, Record<string, unknown>> | undefined;
  const entry = properties?.[property];
  const values = entry?.enum;
  if (!Array.isArray(values) || values.length === 0 || values.some((v) => typeof v !== 'string')) {
    throw new TypeError(`enums.ts: "context.switched" payload has no string enum for "${property}" (got ${JSON.stringify(entry)}); the registry is the only allowed source of this list`);
  }
  return values as string[];
}

export const ENVIRONMENT_VALUES = enumPropertyOf(SIGNALS['context.switched'].payload, 'environment');

// zod needs at least one member and the derivation above refuses an empty list, so the cast is checked by the
// throw rather than by the type: `enumPropertyOf` never returns `[]`.
type NonEmpty<T> = [T, T, ...T[]];
export const SelectableEnvironmentSchema = z.enum(ENVIRONMENT_VALUES as unknown as NonEmpty<string>);

/**
 * The environment half of the context, as a type: read straight out of `context.switched`'s payload type. Not
 * declared here, not spelled here -- derived, which is the same rule 1 applies to a server DTO and the reason
 * there is exactly one list of these names in the repository.
 */
export type SelectableEnvironment = PayloadOf<'context.switched'>['environment'];

export const SELECTABLE_ENVIRONMENTS: readonly string[] = ENVIRONMENT_VALUES;

export function isSelectableEnvironment(value: string): value is SelectableEnvironment {
  return (ENVIRONMENT_VALUES as readonly string[]).includes(value);
}

/**
 * The environments present on these rows that the context signal cannot name.
 *
 * Empty is the normal case and the interesting one is not hypothetical -- `preview` is a first-class value in
 * `redeployInstance`'s request body. Returning them lets a screen *say* so, which is the difference between a
 * limitation and a silence: a control that quietly omits something the tenant has is the "empty div" failure at
 * the size of a feature.
 */
export function unservedEnvironments(rows: readonly { readonly environment: string }[]): string[] {
  return [...new Set(rows.map((row) => row.environment).filter((name) => !isSelectableEnvironment(name)))].sort();
}
