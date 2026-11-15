import { z } from 'zod';

/**
 * Pages as data (docs/design/11). The registry is small on purpose: one entry per component the
 * interface actually needs, each with a strict prop schema. Strictness is not tidiness here — a
 * `secret-field` has no `value` prop, so a page that tries to carry a secret value fails to validate
 * instead of rendering it.
 */
export const COMPONENT_NAMES = [
  'page', 'heading', 'notice', 'badge', 'secret-group', 'secret-field', 'link-field', 'instructions', 'action-button',
] as const;

const Id = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'stable lowercase id');

export const BadgeSchema = z.object({
  component: z.literal('badge'),
  props: z.object({
    id: Id,
    tone: z.enum(['ok', 'pending', 'problem', 'neutral']),
    label: z.string().min(1),
  }).strict(),
});

export const NoticeSchema = z.object({
  component: z.literal('notice'),
  props: z.object({
    id: Id,
    tone: z.enum(['info', 'warning', 'danger']),
    text: z.string().min(1),
  }).strict(),
});

export const HeadingSchema = z.object({
  component: z.literal('heading'),
  props: z.object({ id: Id, level: z.number().int().min(1).max(4), text: z.string().min(1) }).strict(),
});

export const InstructionsSchema = z.object({
  component: z.literal('instructions'),
  props: z.object({
    id: Id,
    title: z.string().min(1),
    steps: z.array(z.string().min(1)).min(1),
  }).strict(),
});

/** An outbound action that carries no value — a deep link into the tenant's own provider UI. */
export const LinkFieldSchema = z.object({
  component: z.literal('link-field'),
  props: z.object({
    id: Id,
    name: z.string().min(1),
    service: z.string().min(1),
    environment: z.string().min(1),
    href: z.string().url(),
    label: z.string().min(1),
    satisfied: z.boolean(),
  }).strict(),
});

/**
 * The write-only secret input. Note what is absent: no `value`, no `currentValue`, no `default`.
 * A form binds this to a one-shot delivery call; the page model can never hold the secret itself.
 */
export const SecretFieldSchema = z.object({
  component: z.literal('secret-field'),
  props: z.object({
    id: Id,
    name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    service: z.string().min(1),
    environment: z.string().min(1),
    source: z.enum(['preserve', 'shared-variable', 'customer-held']),
    mode: z.enum(['relay-sealed', 'relay-plain', 'tenant-side', 'runner-side']),
    label: z.string().min(1),
    help: z.string().min(1),
    satisfied: z.boolean(),
    rotationNotice: z.string().min(1).optional(),
    submitLabel: z.string().min(1),
  }).strict(),
});

export const ActionButtonSchema = z.object({
  component: z.literal('action-button'),
  props: z.object({
    id: Id,
    action: z.string().min(1),
    label: z.string().min(1),
    /** Only the shape of the request; values for secret fields come from the form, never the page. */
    target: z.string().min(1).optional(),
  }).strict(),
});

export const SecretGroupSchema = z.object({
  component: z.literal('secret-group'),
  props: z.object({
    id: Id,
    service: z.string().min(1),
    environment: z.string().min(1),
    /** Placement note so a tenant is not left guessing why a service has no rows here. */
    placement: z.string().min(1).optional(),
  }).strict(),
  children: z.array(z.union([SecretFieldSchema, LinkFieldSchema, InstructionsSchema, BadgeSchema, NoticeSchema, ActionButtonSchema])),
});

/** Everything a page may contain directly. Pages do not nest, so the model stays non-recursive. */
export const PageChildSchema = z.union([
  HeadingSchema, NoticeSchema, BadgeSchema, SecretGroupSchema, SecretFieldSchema, LinkFieldSchema,
  InstructionsSchema, ActionButtonSchema,
]);

export const PageSchema = z.object({
  component: z.literal('page'),
  props: z.object({
    id: Id,
    title: z.string().min(1),
    /** Page-level metadata the SDK/mobile layers use to decide what they can render. */
    platform: z.string().min(1).default('web'),
  }).strict(),
  children: z.array(PageChildSchema),
});

export type PageChild = z.infer<typeof PageChildSchema>;
export type Node = PageChild;
export type Page = z.infer<typeof PageSchema>;
export type SecretField = z.infer<typeof SecretFieldSchema>;
export type SecretGroup = z.infer<typeof SecretGroupSchema>;

/** Component names actually defined above; the registry is what a renderer walks. */
export const COMPONENT_REGISTRY: Record<(typeof COMPONENT_NAMES)[number], string> = {
  page: 'container', heading: 'text', notice: 'text', badge: 'state', 'secret-group': 'container',
  'secret-field': 'write-only input', 'link-field': 'outbound', instructions: 'text', 'action-button': 'action',
};

/**
 * The one implementation of "could this key hold a secret value" (D4, D53).
 *
 * It used to be TWO functions with one name: this one matched a closed list of five key names, while a private
 * copy in `secrets-panel.ts` matched any key containing `value`. Neither covered the other, and both readings
 * looked defensible, which is this project's central failure mode -- one fact, two spellings, and no gate able to
 * see the disagreement. The union lives here now, so nothing that used to be caught is let through.
 *
 * What was missing from BOTH copies, measured before this change: `token`, `apiKey`, `clientSecret` and
 * `passphrase` each returned an empty list. A rule that says "drafts can never hold a secret value" was resting
 * on a name test that did not test for the commonest secret field names in the language.
 *
 * What this still is NOT: proof a value is absent. Page documents are validated by `PageSchema`, so a secret has
 * no legal place to sit; this walk is the backstop for shapes nobody declared. It is a NAME test -- a credential
 * under a neutral key (`note`, `text`) is invisible here and must be refused by the schema and by the builder
 * that composes the document. That limit is stated rather than papered over.
 */

/** Keys that are unambiguously a payload. */
const VALUE_NAME_EXACT = /^(value|currentValue|defaultValue|secretValue|plaintext)$/i;
/** Any other key containing `value` also counts -- the broader half of the old duplicated pair. */
const VALUE_NAME_SUBSTRING = /value/i;
/** Two keys that contain `value` and demonstrably are not payloads. */
const VALUE_NAME_EXEMPT = /^(satisfied|labelValue)$/i;
/** Credential-shaped names, which neither old copy matched. */
const CREDENTIAL_NAME = /(token|secret|password|passphrase|credential|authorization|bearer|api[_-]?key|access[_-]?key|private[_-]?key|session|cookie)/i;

/** The single question the predicate answers, exported so a test can ask it per key instead of by document. */
export function isValueBearingKey(key: string): boolean {
  if (VALUE_NAME_EXEMPT.test(key)) return false;
  return VALUE_NAME_EXACT.test(key) || VALUE_NAME_SUBSTRING.test(key) || CREDENTIAL_NAME.test(key);
}

export function findValueBearingProps(node: unknown, path = ''): string[] {
  const found: string[] = [];
  if (Array.isArray(node)) {
    node.forEach((item, i) => found.push(...findValueBearingProps(item, `${path}[${i}]`)));
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const at = path ? `${path}.${key}` : key;
      if (isValueBearingKey(key)) found.push(at);
      if (value && typeof value === 'object') found.push(...findValueBearingProps(value, at));
    }
  }
  return found;
}
