import { z } from 'zod';

/** Schema version this renderer understands. Bumped only by breaking manifest changes. */
export const SUPPORTED_API_VERSIONS = ['platfolio.dev/v1alpha1'] as const;
/** Version of the renderer itself, checked against `spec.requires.platfolio`. */
export const RENDERER_VERSION = '0.1.0';

const Name = z.string().regex(/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i, 'letters, digits, dot, underscore, hyphen');
const SemverRange = z.string().min(1);
const Version = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'platform version must be semver');

const Service = z.object({
  image: z.string().min(3),
  /** Digest the release job pins. ":latest" and bare tags are rejected by validation. */
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/, 'digest must be sha256:<64 hex>'),
  port: z.number().int().positive(),
  healthPath: z.string().startsWith('/').optional(),
  start: z.string().min(1).optional(),
  build: z.string().min(1).optional(),
  preDeploy: z.string().min(1).optional(),
  rootDirectory: z.string().min(1).optional(),
  replicas: z.number().int().min(1).max(100).default(1),
  limits: z.object({ cpu: z.number().positive(), memoryMB: z.number().int().positive() }).strict().optional(),
  /** Non-secret literals only. Anything that looks like a credential is rejected in validate(). */
  env: z.record(z.string(), z.string()).default({}),
  /** Secret NAMES only, with where the value is resolved from. */
  secrets: z.array(z.object({ name: Name, source: z.enum(['preserve', 'shared-variable', 'customer-held']) }).strict()).default([]),
  domains: z.array(z.string().min(1)).default([]),
  dependsOn: z.array(Name).default([]),
  public: z.boolean().default(false),
}).strict();

const Resources = z.object({
  database: z.object({ name: Name, kind: z.enum(['postgres', 'mysql', 'mongo']) }).strict().optional(),
  cache: z.object({ name: Name, kind: z.enum(['redis']) }).strict().optional(),
  storage: z.object({ name: Name, region: z.string().min(2).optional() }).strict().optional(),
  volumes: z.array(z.object({ name: Name, service: Name, mountPath: z.string().startsWith('/'), sizeGB: z.number().int().positive().optional() }).strict()).default([]),
}).strict();

export const ManifestSchema = z.object({
  apiVersion: z.enum(SUPPORTED_API_VERSIONS),
  kind: z.literal('Platform'),
  metadata: z.object({
    name: Name,
    version: Version,
    title: z.string().min(1),
    summary: z.string().min(1),
    archetype: z.enum(['api-service', 'full-stack-web']),
    repository: z.string().url().optional(),
    license: z.string().min(1).default('Apache-2.0'),
    architectures: z.array(z.enum(['amd64', 'arm64'])).default(['amd64', 'arm64']),
    changelog: z.string().min(1).optional(),
  }).strict(),
  spec: z.object({
    requires: z.object({ platfolio: SemverRange, migrationWindow: z.string().optional() }).strict(),
    identity: z.object({
      mode: z.enum(['none', 'byo-oidc', 'hosted-realm']),
      /** Clients to create in a platfolio-hosted realm. Ignored for byo-oidc/none. */
      clients: z.array(z.object({ service: Name, redirectUris: z.array(z.string()).optional(), roles: z.array(z.string()).optional() }).strict()).default([]),
    }).strict(),
    environments: z.object({
      production: z.object({ branch: z.string().min(1).optional(), enabled: z.boolean().default(true) }).strict(),
      staging: z.object({ enabled: z.boolean().default(false), branch: z.string().min(1).optional(), sleepByDefault: z.boolean().default(true) }).strict(),
      preview: z.object({ enabled: z.boolean().default(false) }).strict(),
    }).strict(),
    resources: Resources.default({ volumes: [] } as never),
    services: z.record(z.string(), Service),
    dns: z.object({ ownershipVerification: z.enum(['txt']).default('txt'), apexPolicy: z.enum(['cname-flattening-only', 'forbidden']).default('cname-flattening-only') }).strict().optional(),
    lifecycle: z.object({
      onSuspend: z.enum(['scale-to-zero']).default('scale-to-zero'),
      onEject: z.array(z.enum(['railway-iac', 'compose', 'data-export', 'realm-export', 'secret-inventory'])).default(['railway-iac', 'compose', 'data-export', 'secret-inventory']),
      onDelete: z.object({ graceDays: z.number().int().min(0).default(30), backupAgeOutDays: z.number().int().min(0).default(90) }).strict(),
    }).strict().optional(),
    observability: z.object({ uptimeChecks: z.array(z.string()).default([]), logRetentionDays: z.number().int().positive().default(7) }).strict().optional(),
    billing: z.object({ sku: Name, metered: z.enum(['none']).default('none') }).strict().optional(),
  }).strict(),
}).strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type ServiceSpec = Manifest['spec']['services'][string];
