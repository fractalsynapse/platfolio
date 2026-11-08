import { z } from 'zod';

/**
 * The `infra.provider` capability: everything platfolio needs from an infrastructure provider, and
 * nothing it should not have. This module is API-stable (see api/contracts.api.md); provider
 * implementations import these types and never the framework.
 *
 * Two rules are structural, not advisory:
 *  - Plans and state carry secret **names** only. There is no field in any schema here that can hold a
 *    secret value, so an implementation cannot accidentally receive one (invariant 1 in
 *    docs/design/00-target-architecture.md).
 *  - Every operation is named in OPERATIONS, which is what the conformance suite, the API baseline and
 *    the drift check all key off.
 */

export const CONTRACT_NAME = 'infra.provider' as const;
export const CONTRACT_VERSION = '1.0.0' as const;

/** Operations a provider must implement to claim contract 1.x. */
export const OPERATIONS = [
  'describe',
  'validatePlan',
  'applyPlan',
  'readState',
  'deleteInstance',
] as const;

export type Operation = (typeof OPERATIONS)[number];

/** Thrown by an implementation that knowingly does not support an operation. */
export class ProviderUnsupported extends Error {
  readonly unsupported = true;
  readonly operation: Operation;
  constructor(operation: Operation, detail?: string) {
    super(`infra.provider operation "${operation}" is not implemented by this provider${detail ? `: ${detail}` : ''}`);
    this.name = 'ProviderUnsupported';
    this.operation = operation;
  }
}

export class ContractMismatch extends Error {
  readonly contractMismatch = true;
  readonly found: string;
  readonly required: string;
  constructor(found: string, required: string) {
    super(`provider contract ${found} does not satisfy required range ${required}`);
    this.name = 'ContractMismatch';
    this.found = found;
    this.required = required;
  }
}

/* ------------------------------------------------------------------ data shapes */

const HostSchema = z
  .string()
  .min(1)
  .refine((host) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host), {
    message: 'host must be a lowercase FQDN without scheme, port or wildcard',
  });

const NameSchema = z
  .string()
  .min(1)
  .refine((v) => /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(v), { message: 'names use letters, digits, dot, underscore, hyphen' });

export const SecretRefSchema = z.object({
  /** Secret name only. A value here is a validation error by construction. */
  name: NameSchema,
  /** Where the value is resolved from; never a platfolio-held value. */
  source: z.enum(['preserve', 'shared-variable', 'resource', 'platform-internal', 'customer-held']),
});

export const ServicePlanSchema = z.object({
  name: NameSchema,
  image: z.string().min(1),
  /** Digest-pinned by the release job; ":latest" is rejected. */
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  command: z.string().optional(),
  port: z.number().int().positive(),
  healthPath: z.string().startsWith('/'),
  preDeployCommand: z.string().optional(),
  replicas: z.number().int().min(1),
  limits: z.object({ cpu: z.number().positive(), memoryMB: z.number().int().positive() }),
  env: z.array(z.object({ name: NameSchema, literal: z.string().optional() }).strict()),
  secrets: z.array(SecretRefSchema),
});

export const DomainPlanSchema = z.object({
  host: HostSchema,
  service: NameSchema,
  port: z.number().int().positive(),
  /** TXT verification token expected at the tenant DNS, never a secret value. */
  verificationName: NameSchema,
});

export const EnvironmentPlanSchema = z.object({
  name: NameSchema,
  cloneFrom: NameSchema.optional(),
  services: z.array(ServicePlanSchema).min(1),
  domains: z.array(DomainPlanSchema),
  databases: z.array(z.object({ name: NameSchema, kind: z.enum(['postgres', 'redis', 'mysql']) })),
  buckets: z.array(z.object({ name: NameSchema, region: NameSchema.optional() })),
});

export const InfraPlanSchema = z.object({
  instanceId: NameSchema,
  teamId: NameSchema,
  provider: NameSchema,
  contract: z.string().min(1),
  /** Hash of the rendered desired state; the idempotency key across retries. */
  planHash: z.string().regex(/^[a-f0-9]{16,64}$/),
  manifestRef: z.object({ platform: NameSchema, version: NameSchema }),
  environments: z.array(EnvironmentPlanSchema).min(1),
});

export const DomainStateSchema = z.object({
  host: HostSchema,
  /** pending | verified | failed — mirrors the provider's own DNS/cert reporting. */
  dnsStatus: z.enum(['pending', 'verified', 'failed']),
  certificateStatus: z.enum(['pending', 'issued', 'failed']),
  targetService: NameSchema,
});

export const ServiceStateSchema = z.object({
  name: NameSchema,
  environment: NameSchema,
  externalId: z.string().min(1),
  /** Provider deployment status, normalized. */
  status: z.enum(['pending', 'building', 'deploying', 'live', 'failed', 'crashed', 'sleeping', 'awaiting-approval', 'removed']),
  image: z.string().min(1),
  numReplicas: z.number().int().min(0),
});

export const StateSnapshotSchema = z.object({
  instanceId: NameSchema,
  projectExternalId: z.string().min(1),
  capturedAt: z.string().min(1),
  services: z.array(ServiceStateSchema),
  domains: z.array(DomainStateSchema),
  /** Provider-native ceilings the tenant is billed against; for display, never for billing. */
  ceilings: z.array(z.object({ name: NameSchema, cpu: z.number(), memoryMB: z.number() })),
});

export const ApplyResultSchema = z.object({
  instanceId: NameSchema,
  planHash: z.string().min(1),
  /** No step may report success without read-back evidence. */
  verified: z.boolean(),
  services: z.array(ServiceStateSchema),
  domains: z.array(DomainStateSchema),
  failures: z.array(z.object({ step: z.string().min(1), code: NameSchema, message: z.string().min(1) })),
  // Informational observations that do not contradict the plan. Kept separate from failures
  // on purpose: the first revision of the Railway provider recorded a placement fallback as a
  // failure, which made a correct apply report itself unverified. Notes must never downgrade a
  // claim quietly, and failures must never be demoted to notes to buy a green.
  notes: z.array(z.object({ step: z.string().min(1), code: NameSchema, message: z.string().min(1) })).optional(),
  noop: z.boolean(),
});

export const DeleteResultSchema = z.object({
  instanceId: NameSchema,
  removed: z.array(z.string().min(1)),
  /** Anything the provider could not remove; a non-empty list must fail the delete. */
  orphans: z.array(z.string().min(1)),
});

export const CapabilityInfoSchema = z.object({
  provider: NameSchema,
  contract: z.string().min(1),
  operations: z.array(z.enum(OPERATIONS)),
  /** Provider-specific optional features keyed by name, e.g. "volumes", "preview-environments". */
  features: z.array(NameSchema),
});

export type InfraPlan = z.infer<typeof InfraPlanSchema>;
export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;
export type ApplyResult = z.infer<typeof ApplyResultSchema>;
export type DeleteResult = z.infer<typeof DeleteResultSchema>;
export type CapabilityInfo = z.infer<typeof CapabilityInfoSchema>;
export type ServicePlan = z.infer<typeof ServicePlanSchema>;
export type EnvironmentPlan = z.infer<typeof EnvironmentPlanSchema>;

/** Normalized validation output: located, machine-readable, no free-form-only errors. */
export const IssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string().min(1),
  message: z.string().min(1),
});
export type Issue = z.infer<typeof IssueSchema>;

/* ------------------------------------------------------------------- interface */

export interface InfraProvider {
  /** The provider's identity and supported subset. Must not throw. */
  describe(): CapabilityInfo;
  /** Pure check: no writes, no external calls. Empty array means the plan is valid. */
  validatePlan(plan: InfraPlan): Issue[];
  /** Idempotent for the same planHash; must verify by read-back before reporting success. */
  applyPlan(plan: InfraPlan): Promise<ApplyResult>;
  readState(instanceId: string): Promise<StateSnapshot>;
  deleteInstance(instanceId: string): Promise<DeleteResult>;
}

/**
 * Minimal semver range support for `"^1.0.0"`, `">=1.0.0 <2"`, `"1.x"` and `"*"`, enough for the
 * contract resolution rules in docs/design/10. Kept here so contracts, kernel and tests agree.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('+')[0]!.split('-')[0]!.split('.').map((n) => Number(n) || 0);
  const [major, minor, patch] = parse(version);
  const cmp = (a: [number, number, number], b: [number, number, number]): number =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  const v: [number, number, number] = [major ?? 0, minor ?? 0, patch ?? 0];
  const trimmed = range.trim();
  if (trimmed === '*' || trimmed === 'x') return true;
  if (trimmed.startsWith('^')) {
    const base = parse(trimmed.slice(1));
    const b: [number, number, number] = [base[0] ?? 0, base[1] ?? 0, base[2] ?? 0];
    // npm caret semantics: ^1.2.3 := >=1.2.3 <2.0.0 ; ^0.9.0 := >=0.9.0 <0.10.0 ; ^0.0.3 := >=0.0.3 <0.0.4
    if (cmp(v, b) < 0) return false;
    if (b[0] > 0) return v[0] === b[0];
    if (b[1] > 0) return v[0] === 0 && v[1] === b[1];
    return v[0] === 0 && v[1] === 0 && v[2] === b[2];
  }
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .every((clause) => {
      // Partial versions are allowed in comparators: "<2" means "<2.0.0".
      const m = clause.match(/^(>=|<=|>|<|=)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
      if (!m) return false;
      const op = m[1] ?? '=';
      const t: [number, number, number] = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
      const c = cmp(v, t);
      return op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
    });
}

/**
 * Cross-field checks that no single-field schema can express. Shared by every provider on purpose:
 * duplicating these per implementation is how one provider ends up accepting a plan another rejects.
 */
export function planIssues(plan: unknown): Issue[] {
  const parsed = InfraPlanSchema.safeParse(plan);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({ path: i.path as (string | number)[], code: 'schema', message: i.message }));
  }
  const data = parsed.data;
  const issues: Issue[] = [];
  const names = data.environments.map((e) => e.name);
  if (new Set(names).size !== names.length) issues.push({ path: ['environments'], code: 'duplicate-environment', message: 'environment names must be unique' });
  for (const env of data.environments) {
    const services = new Set(env.services.map((s) => s.name));
    for (const d of env.domains) {
      if (!services.has(d.service)) {
        issues.push({ path: ['environments', env.name, 'domains', d.host], code: 'unknown-service', message: `domain targets service "${d.service}" which is not in environment "${env.name}"` });
      }
    }
    if (env.cloneFrom && !data.environments.some((e) => e.name === env.cloneFrom)) {
      issues.push({ path: ['environments', env.name, 'cloneFrom'], code: 'unknown-environment', message: `cloneFrom "${env.cloneFrom}" does not name an environment in this plan` });
    }
    for (const s of env.services) {
      for (const pair of s.env) {
        if (pair.literal === undefined) {
          issues.push({ path: ['environments', env.name, 'services', s.name, 'env', pair.name], code: 'empty-literal', message: 'non-secret env entry requires a literal value; secrets belong in secrets[] by name' });
        }
      }
    }
  }
  return issues;
}
