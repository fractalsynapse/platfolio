import { CapabilitySchema, RequiredCapabilitySchema } from '@platfolio/contracts';
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
  /** Which environments this service exists in (D23). Defaults from `ownership`. */
  environments: z.array(z.enum(['production', 'staging'])).optional(),
  /** `external` = an upstream image platfolio hosts but does not develop; production-only by default. */
  ownership: z.enum(['maintained', 'external']).default('maintained'),
  domains: z.array(z.string().min(1)).default([]),
  dependsOn: z.array(Name).default([]),
  public: z.boolean().default(false),
  /**
   * Wiring from a declared database into a service variable. Deliberately NOT part of `secrets[]`: a
   * reference is resolved by the provider and its name is public configuration, while a secret entry is
   * something the tenant must supply. Folding them together would put wiring in the panel that tells
   * tenants what to type (issue #84).
   */
  references: z.array(z.object({ variable: Name, database: Name, output: Name.optional() }).strict()).default([]),
}).strict();

const Resources = z.object({
  database: z.object({ name: Name, kind: z.enum(['postgres', 'mysql', 'mongo']) }).strict().optional(),
  cache: z.object({ name: Name, kind: z.enum(['redis']) }).strict().optional(),
  storage: z.object({ name: Name, region: z.string().min(2).optional() }).strict().optional(),
  volumes: z.array(z.object({ name: Name, service: Name, mountPath: z.string().startsWith('/'), sizeGB: z.number().int().positive().optional(), retention: z.enum(['instance', 'survive']).optional() }).strict()).default([]),
}).strict();

export const ManifestSchema = z.object({
  apiVersion: z.enum(SUPPORTED_API_VERSIONS),
  kind: z.literal('Platform'),
  metadata: z.object({
    name: Name,
    version: Version,
    title: z.string().min(1),
    summary: z.string().min(1),
    /**
     * The platform is one of two things (D51): a `web` service that accepts connections, or a `worker` that
     * does not. Everything the old four-value `archetype` conflated splits out of this pair:
     *
     * - `mode` says whether the platform is developed (`development`: staging beside production, a local
     *   overlay, commits flowing) or merely operated (`hosted`: production only -- an upstream container plus a
     *   database pulled by an existing template, which is exactly what `shared-identity` is).
     * - being a team service is NOT a kind. It is `spec.provides`, modelled since D34: a shared identity
     *   provider is a web platform in hosted mode that offers a capability, not a fourth shape.
     *
     * `archetype` is gone as authored input. The old labels carried rules that were really counts -- "an
     * api-service has at most 2 services", "full-stack-web needs at least 2" -- which described our own example
     * manifests and would have refused a tenant's legitimate third worker. What survives is about direction
     * (who accepts connections) and lifecycle (which environments exist), because those are architecture
     * rather than taste.
     */
    kind: z.enum(['web', 'worker']),
    /**
     * Set by the Compose translator when a document still declares the retired `archetype` (D51). The kind and
     * mode rules do not bind such a document: the labels it chose were never the facts those rules read, so
     * retro-applying them would convert a vocabulary migration into a wall of refusals against documents that
     * predate it. They get `legacy-archetype` -- a warning naming what to write instead -- and nothing else.
     */
    legacyShape: z.boolean().optional(),
    mode: z.enum(['development', 'hosted']).default('development'),
    repository: z.string().url().optional(),
    license: z.string().min(1).default('Apache-2.0'),
    architectures: z.array(z.enum(['amd64', 'arm64'])).default(['amd64', 'arm64']),
    changelog: z.string().min(1).optional(),
  }).strict(),
  spec: z.object({
    requires: z.object({ platfolio: SemverRange, migrationWindow: z.string().optional() }).strict(),
    /**
     * Capabilities this platform needs from elsewhere in the team (D34). Named by capability, never by
     * instance, so a team can swap its identity provider without editing every consumer. Where the resolved
     * values land is the environment inventory's job (`kind: output`), not this one's.
     */
    capabilities: z.array(RequiredCapabilitySchema).default([]),
    /** Declared when this platform IS a team service: what it publishes for others to require. */
    provides: CapabilitySchema.optional(),
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
    /**
     * How the release pipeline produces the image a plan is allowed to pin (D16, D29). The authouring file
     * names the registry and the recipe; the digest arrives in the generated prod overlay, never here --
     * which is what makes "nobody maintains the prod file by hand" checkable rather than aspirational.
     */
    release: z.object({
      registryImage: z.string().min(3),
      buildPath: z.string().min(1).optional(),
      dockerfile: z.string().min(1).optional(),
      /** Branch/tag pattern the pipeline builds. A pattern that can yield `:latest` is refused. */
      tagPattern: z.string().min(1).optional(),
    }).strict().optional(),
    dns: z.object({
      ownershipVerification: z.enum(['txt']).default('txt'),
      apexPolicy: z.enum(['cname-flattening-only', 'forbidden']).default('cname-flattening-only'),
      /**
       * How a staging host is derived from a declared production host. Rendered explicitly rather than
       * left to provider magic: a service present in both environments cannot claim the same host twice.
       */
      stagingPrefix: z.string().min(1).default('staging-'),
    }).strict().optional(),
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
