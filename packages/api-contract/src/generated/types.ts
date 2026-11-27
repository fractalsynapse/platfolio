/**
 * GENERATED FILE -- DO NOT EDIT. The writer is `scripts/gen-api-types.ts` (the emitter lives in
 * packages/api-contract/src/generate-types.ts) and it is the only one: nothing here is worth editing by
 * hand, because every line reproduces from the specification.
 *
 * Source: apps/control-plane/openapi.yaml (OpenAPI 3.1.0, info.version 0.1.0)
 * Input digest: sha256/090bc30dc8365ccc
 *
 * Reproduce it with `pnpm run api:types`. `pnpm run api:types:check` fails when this file stops matching
 * what the committed spec produces, which is the only way a generated type deserves to be trusted.
 *
 * These are the document's types, not the runtime's. `packages/contracts` holds the StandardSchema
 * definitions the server validates against, and `pnpm run api:check` compares the two shape sets (#247)
 * so this file cannot silently describe a shape the server stopped producing.
 *
 * Import note, because the document names one component `Error`: a bare `import type { Error } from` this
 * file shadows the global `Error` TYPE in the importing module (the value, `new Error(…)`, is untouched --
 * measured, not reasoned from habit). Someone who wants both should write `import type { Error as ApiError }`,
 * or reach for the whole surface with `import type * as Api` and use `Api.Error`.
 */

export interface ApplyResult {
  instanceId: string;
  planHash: string;
  verified: boolean;
  services: Array<{
    name: string;
    environment: string;
    externalId: string;
    status: 'pending' | 'building' | 'deploying' | 'live' | 'stopped' | 'failed' | 'crashed' | 'sleeping' | 'awaiting-approval' | 'removed';
    rawStatus?: string;
    image: string;
    numReplicas: number;
  }>;
  domains: Array<{
    host: string;
    dnsStatus: 'pending' | 'verified' | 'failed';
    certificateStatus: 'pending' | 'issued' | 'failed';
    records?: Array<{
      host: string;
      fqdn: string;
      zone: string;
      type: 'A' | 'CNAME' | 'TXT' | 'NS';
      value: string;
      current?: string;
      status: 'requires-update' | 'propagated' | 'unspecified';
      purpose: 'traffic' | 'ownership' | 'challenge' | 'unspecified';
    }>;
    targetService: string;
  }>;
  failures: Array<{
    step: string;
    code: string;
    message: string;
  }>;
  notes?: Array<{
    step: string;
    code: string;
    message: string;
  }>;
  noop: boolean;
}

export interface Attestation {
  dispatchId: string;
  nonce: string;
  planHash: string;
  instanceId: string;
  environment: string;
  action: 'apply' | 'check' | 'drift' | 'suspend' | 'export';
  result: 'ok' | 'partial' | 'failed' | 'noop';
  errorCode?: string;
  resources: Array<{
    kind: 'service' | 'database' | 'bucket' | 'volume' | 'domain' | 'environment';
    name: string;
    externalId: string;
    status: 'pending' | 'building' | 'deploying' | 'live' | 'failed' | 'crashed' | 'sleeping' | 'awaiting-approval' | 'removed';
  }>;
  release?: {
    version: string;
    /** The commit the release was built from. Seven to forty hex characters: a short SHA is a display form, a full one is an anchor. */
    commitSha: string;
    imageDigest: string;
  };
  durationMs: number;
  finishedAt: string;
}

export interface AttestationRecord {
  dispatchId: string;
  nonce: string;
  planHash: string;
  instanceId: string;
  environment: string;
  action: 'apply' | 'check' | 'drift' | 'suspend' | 'export';
  result: 'ok' | 'partial' | 'failed' | 'noop';
  errorCode?: string;
  resources: Array<{
    kind: 'service' | 'database' | 'bucket' | 'volume' | 'domain' | 'environment';
    name: string;
    externalId: string;
    status: 'pending' | 'building' | 'deploying' | 'live' | 'failed' | 'crashed' | 'sleeping' | 'awaiting-approval' | 'removed';
  }>;
  release?: {
    version: string;
    /** The commit the release was built from. Seven to forty hex characters: a short SHA is a display form, a full one is an anchor. */
    commitSha: string;
    imageDigest: string;
  };
  durationMs: number;
  finishedAt: string;
  receivedAt: string;
  actorKind: 'runner' | 'operator' | 'shared-secret';
  actorRef?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorKind: 'user' | 'runner' | 'controller' | 'system';
  actorRef: string;
  action: string;
  target: string;
  /** Structured, bounded, and never a credential: reason codes and ids, not payloads (D4). */
  detail: Record<string, string | number | boolean>;
}

export interface BindingRecord {
  consumerInstanceId: string;
  capability: string;
  providerInstanceId: string;
  destinations: Array<{
    output: string;
    into: string[];
  }>;
  state: 'bound' | 'stale';
  boundAt: string;
  boundBy: string;
}

export interface CapabilityOffer {
  instanceId: string;
  teamId: string;
  capability: string;
  outputs: Array<{
    output: string;
    kind: 'url' | 'value' | 'secret';
    state: 'not-issued' | 'issued-and-placed' | 'placement-unknown' | 're-issue-required';
  }>;
  publishedAt: string;
}

export interface CapabilityShare {
  instanceId: string;
  capability: string;
  toTeamId: string;
  sharedAt: string;
  sharedBy: string;
}

export interface CurrentPerson {
  personId: string;
  kind: 'human' | 'service';
  identities: Array<{
    issuer: string;
    subject: string;
  }>;
  teams: Array<{
    teamId: string;
    name: string;
    role: 'owner' | 'member';
  }>;
}

export interface DeleteResult {
  instanceId: string;
  removed: string[];
  orphans: string[];
  failures?: Array<{
    step: string;
    code: string;
    message: string;
  }>;
  releasedWithProject?: string[];
  retained?: string[];
}

export interface DispatchIntent {
  instanceId: string;
  teamId: string;
  dispatchId: string;
  nonce: string;
  planHash: string;
  action: 'apply' | 'check' | 'drift' | 'suspend' | 'export';
  environment: string;
  issuedAt: string;
  expiresAt: string;
}

export interface Error {
  /** Machine-readable code. Stable, so clients branch on it rather than on prose. */
  error: string;
  /** Human-readable, and credential-safe by construction: the server redacts credential-shaped text before writing it (the same `redactCredentialShaped` rule the managed action applies to attestation fields). */
  message: string;
}

export interface Health {
  status: 'ok';
  /** sha256(commit + version), truncated. Not a credential. */
  livenessToken: string;
}

export interface HostedCustomDomain {
  host: string;
  dnsStatus: 'pending' | 'verified' | 'failed';
  certificateStatus: 'pending' | 'issued' | 'failed';
  records: Array<{
    host: string;
    fqdn: string;
    zone: string;
    type: 'A' | 'CNAME' | 'TXT' | 'NS';
    value: string;
    current?: string;
    status: 'requires-update' | 'propagated' | 'unspecified';
    purpose: 'traffic' | 'ownership' | 'challenge' | 'unspecified';
  }>;
}

export interface HostedStarter {
  instanceId: string;
  projectId: string;
  deploymentId: string;
  state: 'live' | 'paused' | 'removed';
  origin?: string;
  observedAt: string;
}

export interface HostingRemovalRequest {
  data: 'keep' | 'wipe';
  confirmation?: string;
}

export interface HubInstallationJournal {
  id: string;
  name: string;
  workspaceId: string;
  state: 'running' | 'failed' | 'ready' | 'removed';
  maintenance?: 'update' | 'wipe';
  maintenanceEnvironment?: 'staging' | 'production';
  canRemove?: boolean;
  installed?: Array<{
    name: 'staging' | 'production';
    revision: string;
  }>;
  requested: ('staging' | 'production')[];
  verified: ('staging' | 'production')[];
}

export interface HubInstallationLaunch {
  state: 'authorizing' | 'authorized' | 'running' | 'ready' | 'failed' | 'removed';
  projectId?: string;
  workspaces: Array<{
    id: string;
    name: string;
  }>;
  events: Array<{
    at: string;
    step: string;
    state: 'WORKING' | 'READY' | 'FAILED';
  }>;
  environments: Array<{
    name: 'staging' | 'production';
    origin: string;
  }>;
}

export interface InstallationLaunchInput {
  workspaceId: string;
  name: string;
  environments: ('staging' | 'production')[];
  ownerEmail: string;
  verifier: string;
  salt: string;
}

export interface Instance {
  id: string;
  teamId: string;
  /** The half of `team/name` a person types (D45). Slug rules, enforced in the schema and the database: a name needing escapes or a disambiguating id is a name that will break in a URL, a CLI argument, or a shell. */
  name: string;
  /** The template this instance was created from. Formerly the field `platform`, which stored a template id -- D45. */
  template: string;
  templateRef?: {
    repo: string;
    /** Pinned by commit, never by a movable tag (D30 law 3). */
    commitSha: string;
  };
  /** The rollup, not the truth: production's state when a production environment exists, otherwise the worst among the environments (#179). `InstanceResponse.environments` is what actually happened per place. */
  state: 'pending' | 'provisioning' | 'live' | 'degraded' | 'paused' | 'failed' | 'deprovisioning' | 'removed';
  provider: string;
  desiredPlanHash?: string;
  lastAppliedPlanHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceResponse {
  id: string;
  teamId: string;
  /** The half of `team/name` a person types (D45). Slug rules, enforced in the schema and the database: a name needing escapes or a disambiguating id is a name that will break in a URL, a CLI argument, or a shell. */
  name: string;
  /** The template this instance was created from. Formerly the field `platform`, which stored a template id -- D45. */
  template: string;
  templateRef?: {
    repo: string;
    /** Pinned by commit, never by a movable tag (D30 law 3). */
    commitSha: string;
  };
  /** The rollup, not the truth: production's state when a production environment exists, otherwise the worst among the environments (#179). `InstanceResponse.environments` is what actually happened per place. */
  state: 'pending' | 'provisioning' | 'live' | 'degraded' | 'paused' | 'failed' | 'deprovisioning' | 'removed';
  provider: string;
  desiredPlanHash?: string;
  lastAppliedPlanHash?: string;
  createdAt: string;
  updatedAt: string;
  /** One row per environment the instance has. The assembled response always carries it; it is empty until the first reconcile. */
  environments: Array<{
    instanceId: string;
    environment: string;
    /** What the controller last verified for this environment, which is the only sense in which `live` means anything (#179). */
    state: 'pending' | 'provisioning' | 'live' | 'degraded' | 'paused' | 'failed' | 'deprovisioning' | 'removed';
    appliedPlanHash?: string;
    attestationId?: string;
    updatedAt: string;
  }>;
}

export interface Invitation {
  id: string;
  teamId: string;
  teamName?: string;
  /** Normalised (trimmed and case-folded) on write. */
  email: string;
  role: 'owner' | 'member';
  state: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedBy?: string;
  acceptedAt?: string;
  revokedAt?: string;
  /** The transport's receipt, so delivery is a fact about the row (D46). */
  emailReceipt?: string;
  emailError?: string;
}

export interface MarketplaceArtifactAcquisition {
  id: string;
  teamId: string;
  acquiredAt: string;
  variant: 'starter-template' | 'shared-service' | 'hosted-application';
  release: {
    platformId: string;
    version: string;
    images: string[];
    installer: string;
    descriptorDigest: string;
    bundle: {
      compose: string;
      inventory: string;
      offer: 'free' | 'maintenance';
    };
  };
}

export interface MarketplaceArtifactGrant {
  registry: string;
  namespace: string;
  username: 'platfolio';
  password: string;
  expiresAt: string;
}

export interface MarketplaceArtifactVersion {
  version: string;
}

export interface MarketplaceBundlePublication {
  version: string;
  bundle: {
    compose: string;
    inventory: string;
    offer: 'free' | 'maintenance';
  };
  images: string[];
}

export interface MarketplaceInstall {
  instance: {
    id: string;
    teamId: string;
    name: string;
    template: string;
    templateRef?: {
      repo: string;
      commitSha: string;
    };
    state: 'pending' | 'provisioning' | 'live' | 'degraded' | 'paused' | 'failed' | 'deprovisioning' | 'removed';
    provider: string;
    desiredPlanHash?: string;
    lastAppliedPlanHash?: string;
    createdAt: string;
    updatedAt: string;
  };
  receiptId: string;
  release: {
    platformId: string;
    version: string;
    descriptorDigest: string;
  };
  variant: 'starter-template' | 'shared-service' | 'hosted-application';
}

export interface MarketplaceInstallInput {
  name: string;
  release: {
    platformId: string;
    version: string;
    descriptorDigest: string;
  };
  sourceRepository?: string;
}

export interface MarketplaceInstallation {
  installationId: string;
  state: 'pending' | 'connected' | 'linked' | 'disconnected';
}

export interface MarketplaceMaintenanceInput {
  buyerTeamId: string;
  through: string;
}

export interface MarketplacePlatform {
  id: string;
  title: string;
  variant: 'starter-template' | 'shared-service' | 'hosted-application';
  publisherTeamId?: string;
  slug?: string;
  latestRelease: {
    platformId: string;
    version: string;
    source?: {
      repo: string;
      revision: string;
    };
    images: string[];
    installer: string;
    descriptorDigest: string;
    bundle?: {
      compose: string;
      inventory: string;
      offer: 'free' | 'maintenance';
    };
    offer?: 'free' | 'maintenance';
  };
}

export interface MarketplacePlatformAcquisition {
  id: string;
  teamId: string;
  acquiredAt: string;
  variant: 'starter-template' | 'shared-service' | 'hosted-application';
  release: {
    platformId: string;
    version: string;
    source: {
      repo: string;
      revision: string;
    };
    images: string[];
    installer: string;
    descriptorDigest: string;
  };
}

export interface MarketplacePlatformAcquisitionInput {
  platformId: string;
  version: string;
  descriptorDigest: string;
}

export interface MarketplacePlatformCreation {
  slug: string;
  title: string;
  variant: 'starter-template' | 'shared-service' | 'hosted-application';
}

export interface MarketplacePlatformPublication {
  version: string;
  source: {
    repo: string;
    revision: string;
  };
  images: string[];
}

export interface MarketplacePlatformRelease {
  platformId: string;
  version: string;
  source?: {
    repo: string;
    revision: string;
  };
  images: string[];
  installer: string;
  descriptorDigest: string;
  bundle?: {
    compose: string;
    inventory: string;
    offer: 'free' | 'maintenance';
  };
  offer?: 'free' | 'maintenance';
}

export interface MarketplacePublisherPlatform {
  slug: string;
  title: string;
  variant: 'starter-template' | 'shared-service' | 'hosted-application';
  id: string;
  publisherTeamId: string;
}

export interface MarketplaceRelease {
  version: string;
  revision: string;
  template: 'starter-web' | 'starter-worker' | 'shared-identity';
  installer: string;
  image?: string;
  repo: string;
  priceMinor: 0;
  installable: boolean;
}

export interface MarketplaceReleasePublication {
  version: string;
  revision: string;
  template: 'starter-web' | 'starter-worker' | 'shared-identity';
  installer: string;
  image?: string;
}

export interface MarketplaceReleaseSelection {
  version: string;
  revision: string;
}

export interface NotificationRule {
  id: string;
  instanceId: string;
  event: 'deployment-failed' | 'app-outage' | 'secret-updated';
  enabled: boolean;
  createdAt: string;
  environment?: string;
}

export interface ReadinessCheck {
  /** Dependency identifier, stable across builds (`database`, `identity`). */
  name: string;
  status: 'ok' | 'degraded' | 'failed' | 'not-configured';
  /** Present for `degraded` and `failed`, and it must not contain a credential, DSN or connection string — names and reasons only (D4). */
  detail?: string;
}

export interface Ready {
  status: 'ready' | 'not-ready';
  checks: ReadinessCheck[];
}

/** Repository-style slug. Lowercase alphanumerics with interior hyphens -- it is a URL segment and a CLI argument (D45). */
export type Slug = string;

export interface StarterBrandChange {
  value: string;
}

export interface StateSnapshot {
  instanceId: string;
  projectExternalId: string;
  capturedAt: string;
  services: Array<{
    name: string;
    environment: string;
    externalId: string;
    status: 'pending' | 'building' | 'deploying' | 'live' | 'stopped' | 'failed' | 'crashed' | 'sleeping' | 'awaiting-approval' | 'removed';
    rawStatus?: string;
    image: string;
    numReplicas: number;
  }>;
  domains: Array<{
    host: string;
    dnsStatus: 'pending' | 'verified' | 'failed';
    certificateStatus: 'pending' | 'issued' | 'failed';
    records?: Array<{
      host: string;
      fqdn: string;
      zone: string;
      type: 'A' | 'CNAME' | 'TXT' | 'NS';
      value: string;
      current?: string;
      status: 'requires-update' | 'propagated' | 'unspecified';
      purpose: 'traffic' | 'ownership' | 'challenge' | 'unspecified';
    }>;
    targetService: string;
  }>;
  ceilings: Array<{
    name: string;
    cpu: number;
    memoryMB: number;
  }>;
}

export interface TeamWithRole {
  teamId: string;
  name: Slug;
  role: 'owner' | 'member';
}

export interface Version {
  name: 'control-plane';
  /** SemVer release tag for this build, or null for an untagged candidate. */
  version: (string | null);
  commit: string;
  buildTime: string;
  providerContract: {
    name: 'infra.provider';
    version: string;
  };
}

export interface Whoami {
  /** The token `sub`. Never a secret. */
  subject: string;
  /** The `iss` that was checked against the pinned issuer. */
  issuer: string;
  /** The `aud` claim(s) that satisfied the required audience. */
  audience: string[];
  /** Authorized party (`azp` or `client_id`). */
  clientId: string;
  /** Empty when the token carries none; absence is not the same as `all`. */
  scope: string[];
  expiresAt: string;
  /** Always false, and asserted rather than implied: this token authenticates a platfolio user to platfolio and confers no authority over tenant infrastructure (docs/design/05 invariants). */
  tenantAuthority: false;
}

/**
 * The declared parameters of each operation, keyed by operationId. Path parameters are required because the
 * spec requires them; query parameters carry the optionality the spec gives them.
 *
 * GENERATED -- `pnpm run api:types:check` fails if this file stops reproducing from the committed spec.
 */
export interface ApiParameters {
  /** POST /api/v1/me/invitations/{invitationId}/accept */
  acceptInvitation: {
    invitationId: string;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/bundle-acquisitions */
  acquireMarketplaceArtifactRelease: {
    installationId: string;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/acquisitions */
  acquireMarketplacePlatformRelease: {
    installationId: string;
  };
  /** POST /api/v1/instances/{instanceId}/hosting/apply */
  applyInstanceHostingPlan: {
    instanceId: string;
  };
  /** PUT /api/v1/instances/{instanceId}/environments/{environment}/custom-domains/{hostname} */
  attachHostedCustomDomain: {
    instanceId: string;
    environment: string;
    hostname: string;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/installation-launches */
  authorizeHubInstallation: {
    teamId: string;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch/railway */
  beginStarterRailwayAuthorization: {
    teamId: string;
  };
  /** PUT /api/v1/instances/{instanceId}/bindings/{capability} */
  bindCapability: {
    instanceId: string;
    capability: string;
  };
  /** PUT /api/v1/instances/{instanceId}/bindings/identity/intent */
  bindSharedIdentity: {
    instanceId: string;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/claim */
  claimEnrolledMarketplaceRelease: {
    installationId: string;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/installations/{installationId}/claim */
  claimFreeMarketplaceRelease: {
    teamId: string;
    installationId: string;
  };
  /** GET /api/v1/hosting/installation-authorization/callback */
  completeHubInstallationAuthorization: {
    state?: string;
    code?: string;
    iss?: string;
    error?: string;
  };
  /** GET /api/v1/railway/callback */
  completeStarterRailwayAuthorization: {
    state?: string;
    code?: string;
    iss?: string;
    error?: string;
  };
  /** PUT /api/v1/teams/{teamId}/marketplace/installations/{installationId} */
  connectMarketplaceInstallation: {
    teamId: string;
    installationId: string;
  };
  /** POST /api/v1/instances/{instanceId}/dispatches */
  createDispatch: {
    instanceId: string;
  };
  /** POST /api/v1/instances */
  createInstance: Record<string, never>;
  /** POST /api/v1/teams/{teamId}/invitations */
  createInvitation: {
    teamId: string;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/platforms */
  createMarketplacePlatform: {
    teamId: string;
  };
  /** POST /api/v1/instances/{instanceId}/notification-rules */
  createNotificationRule: {
    instanceId: string;
  };
  /** POST /api/v1/teams */
  createTeam: Record<string, never>;
  /** DELETE /api/v1/instances/{instanceId}/notification-rules/{ruleId} */
  deleteNotificationRule: {
    instanceId: string;
    ruleId: string;
  };
  /** DELETE /api/v1/instances/{instanceId} */
  destroyInstance: {
    instanceId: string;
  };
  /** DELETE /api/v1/instances/{instanceId}/environments/{environment}/custom-domains/{hostname} */
  detachHostedCustomDomain: {
    instanceId: string;
    environment: string;
    hostname: string;
  };
  /** DELETE /api/v1/teams/{teamId}/marketplace/installations/{installationId} */
  disconnectMarketplaceInstallation: {
    teamId: string;
    installationId: string;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/connection */
  enrollPrivateMarketplaceConnection: {
    teamId: string;
  };
  /** GET /api/v1/me/profile */
  getAccountProfile: Record<string, never>;
  /** GET /api/v1/me */
  getCurrentPerson: Record<string, never>;
  /** GET /api/v1/instances/{instanceId}/dispatches/{dispatchId} */
  getDispatchPlan: {
    instanceId: string;
    dispatchId: string;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/catalog */
  getEnrolledMarketplaceCatalog: {
    installationId: string;
    format?: 'releases';
  };
  /** GET /healthz */
  getHealth: Record<string, never>;
  /** GET /api/v1/instances/{instanceId}/status */
  getHostedAppStatus: {
    instanceId: string;
  };
  /** GET /api/v1/instances/{instanceId}/environments/{environment}/configuration/starter-brand */
  getHostedStarterBrand: {
    instanceId: string;
    environment: string;
  };
  /** GET /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId} */
  getHubInstallationLaunch: {
    teamId: string;
    launchId: string;
  };
  /** GET /api/v1/teams/{teamId}/marketplace/installation-offer */
  getHubInstallationOffer: {
    teamId: string;
  };
  /** GET /api/v1/instances/{instanceId} */
  getInstance: {
    instanceId: string;
  };
  /** GET /api/v1/instances/{instanceId}/environments/{environment} */
  getInstanceEnvironment: {
    instanceId: string;
    environment: string;
  };
  /** GET /api/v1/instances/{instanceId}/hosting */
  getInstanceHostingState: {
    instanceId: string;
  };
  /** GET /api/v1/instances/{instanceId}/latest-attestation */
  getLatestAttestation: {
    instanceId: string;
  };
  /** GET /api/v1/me/notification-email */
  getMyNotificationEmail: Record<string, never>;
  /** GET /api/v1/teams/{teamId}/marketplace/connection */
  getPrivateMarketplaceConnection: {
    teamId: string;
  };
  /** GET /api/v1/marketplace/catalog */
  getPublicMarketplaceCatalog: Record<string, never>;
  /** GET /readyz */
  getReady: Record<string, never>;
  /** GET /api/v1/teams/{teamId}/starter-launch */
  getStarterLaunch: {
    teamId: string;
    template?: 'shared-identity' | 'starter-worker';
  };
  /** GET /api/v1/teams/{teamId}/starter-launch/setup */
  getStarterLaunchSetup: {
    teamId: string;
  };
  /** GET /status */
  getStatus: Record<string, never>;
  /** GET /version */
  getVersion: Record<string, never>;
  /** GET /api/v1/whoami */
  getWhoami: Record<string, never>;
  /** POST /api/v1/teams/{teamId}/starter-launch/openbao */
  initializeStarterOpenBao: {
    teamId: string;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/installations/{installationId}/enrollment */
  issueMarketplaceEnrollment: {
    teamId: string;
    installationId: string;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/pulls */
  issueMarketplacePullGrant: {
    installationId: string;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/uploads */
  issueMarketplaceUploadGrant: {
    teamId: string;
    platformId: string;
  };
  /** GET /api/v1/audit */
  listAudit: {
    limit?: number;
  };
  /** GET /api/v1/capabilities */
  listAvailableCapabilities: {
    capability?: string;
  };
  /** GET /api/v1/instances/{instanceId}/bindings */
  listBindings: {
    instanceId: string;
  };
  /** GET /api/v1/instances/{instanceId}/consumers */
  listConsumers: {
    instanceId: string;
  };
  /** GET /api/v1/instances/{instanceId}/environments/{environment}/custom-domains */
  listHostedCustomDomains: {
    instanceId: string;
    environment: string;
  };
  /** GET /api/v1/teams/{teamId}/marketplace/installation-launches */
  listHubInstallationLaunches: {
    teamId: string;
  };
  /** GET /api/v1/templates */
  listInstallableTemplates: Record<string, never>;
  /** GET /api/v1/instances */
  listInstances: Record<string, never>;
  /** GET /api/v1/teams/{teamId}/invitations */
  listInvitations: {
    teamId: string;
  };
  /** GET /api/v1/teams/{teamId}/marketplace/installations */
  listMarketplaceInstallations: {
    teamId: string;
  };
  /** GET /api/v1/marketplace/platforms/{platformId}/releases */
  listMarketplacePlatformReleases: {
    platformId: string;
  };
  /** GET /api/v1/marketplace/platforms */
  listMarketplacePlatforms: Record<string, never>;
  /** GET /api/v1/me/invitations */
  listMyInvitations: Record<string, never>;
  /** GET /api/v1/me/notifications */
  listMyNotifications: Record<string, never>;
  /** GET /api/v1/instances/{instanceId}/secrets */
  listSecretPresence: {
    instanceId: string;
    environment: string;
    service: string;
  };
  /** GET /api/v1/teams/{teamId}/activity */
  listTeamActivity: {
    teamId: string;
  };
  /** GET /api/v1/teams/{teamId}/members */
  listTeamMembers: {
    teamId: string;
  };
  /** GET /api/v1/teams */
  listTeams: Record<string, never>;
  /** POST /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId}/maintenance */
  maintainHubInstallation: {
    teamId: string;
    launchId: string;
  };
  /** POST /api/v1/attestations */
  postAttestation: Record<string, never>;
  /** POST /api/v1/teams/{teamId}/marketplace/installs */
  preparePrivateMarketplaceInstall: {
    teamId: string;
  };
  /** POST /api/v1/instances/{instanceId}/capability */
  publishCapability: {
    instanceId: string;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/bundles */
  publishMarketplaceArtifactBundle: {
    teamId: string;
    platformId: string;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/releases */
  publishMarketplacePlatformRelease: {
    teamId: string;
    platformId: string;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/releases */
  publishMarketplaceRelease: {
    teamId: string;
  };
  /** PUT /api/v1/instances/{instanceId}/capability/identity */
  publishSharedIdentityCapability: {
    instanceId: string;
  };
  /** PUT /api/v1/instances/{instanceId}/plan */
  putPlan: {
    instanceId: string;
  };
  /** PUT /api/v1/instances/{instanceId}/secrets/{name} */
  putSecret: {
    instanceId: string;
    name: string;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/enrollment */
  redeemMarketplaceEnrollment: {
    installationId: string;
  };
  /** POST /api/v1/instances/{instanceId}/environments/{environment}/deployments */
  redeployHostedStarter: {
    instanceId: string;
    environment: string;
  };
  /** POST /api/v1/instances/{instanceId}/redeploy */
  redeployInstance: {
    instanceId: string;
  };
  /** POST /api/v1/instances/{instanceId}/plan/from-repository */
  registerPlanFromRepository: {
    instanceId: string;
  };
  /** POST /api/v1/instances/{instanceId}/hosting/removal */
  removeInstanceHosting: {
    instanceId: string;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch/remove */
  removeStarterLaunch: {
    teamId: string;
    template?: 'shared-identity' | 'starter-worker';
  };
  /** DELETE /api/v1/teams/{teamId}/members/{personId} */
  removeTeamMember: {
    teamId: string;
    personId: string;
  };
  /** POST /api/v1/instances/{instanceId}/artifacts */
  reportArtifact: {
    instanceId: string;
  };
  /** DELETE /api/v1/instances/{instanceId}/capability/{capability}/shares/{toTeamId} */
  revokeCapabilityShare: {
    instanceId: string;
    capability: string;
    toTeamId: string;
  };
  /** DELETE /api/v1/teams/{teamId}/invitations/{invitationId} */
  revokeInvitation: {
    teamId: string;
    invitationId: string;
  };
  /** PUT /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/maintenance */
  setMarketplaceMaintenance: {
    teamId: string;
    platformId: string;
  };
  /** PUT /api/v1/instances/{instanceId}/capability/{capability}/shares */
  shareCapability: {
    instanceId: string;
    capability: string;
  };
  /** PUT /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId} */
  startHubInstallation: {
    teamId: string;
    launchId: string;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch */
  startStarterLaunch: {
    teamId: string;
    template?: 'shared-identity' | 'starter-worker';
  };
  /** POST /api/v1/instances/{instanceId}/dispatches/{dispatchId}/trigger */
  triggerDispatch: {
    instanceId: string;
    dispatchId: string;
  };
  /** DELETE /api/v1/instances/{instanceId}/bindings/{capability} */
  unbindCapability: {
    instanceId: string;
    capability: string;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch/openbao/unlock */
  unlockStarterOpenBao: {
    teamId: string;
  };
  /** PUT /api/v1/me/profile */
  updateAccountProfile: Record<string, never>;
  /** PUT /api/v1/instances/{instanceId}/environments/{environment}/configuration/starter-brand */
  updateHostedStarterBrand: {
    instanceId: string;
    environment: string;
  };
  /** PUT /api/v1/me/notification-email */
  updateMyNotificationEmail: Record<string, never>;
  /** PUT /api/v1/instances/{instanceId}/notification-rules/{ruleId} */
  updateNotificationRule: {
    instanceId: string;
    ruleId: string;
  };
  /** PATCH /api/v1/teams/{teamId}/members/{personId} */
  updateTeamMemberRole: {
    teamId: string;
    personId: string;
  };
}

/**
 * The request body each operation accepts, keyed by operationId. Operations with no request body are absent,
 * so `RequestBodyOf` resolves to `undefined` for them rather than to a shape they never declare.
 *
 * GENERATED -- `pnpm run api:types:check` fails if this file stops reproducing from the committed spec.
 */
export interface ApiRequestBodies {
  /** POST /api/v1/me/invitations/{invitationId}/accept */
  acceptInvitation: Record<string, never>;
  /** POST /api/v1/marketplace/installations/{installationId}/bundle-acquisitions */
  acquireMarketplaceArtifactRelease: MarketplacePlatformAcquisitionInput;
  /** POST /api/v1/marketplace/installations/{installationId}/acquisitions */
  acquireMarketplacePlatformRelease: MarketplacePlatformAcquisitionInput;
  /** POST /api/v1/teams/{teamId}/marketplace/installation-launches */
  authorizeHubInstallation: {
    installationId: string;
  };
  /** PUT /api/v1/instances/{instanceId}/bindings/{capability} */
  bindCapability: {
    providerInstanceId: string;
    destinations: Array<{
      output: string;
      into: string[];
    }>;
  };
  /** PUT /api/v1/instances/{instanceId}/bindings/identity/intent */
  bindSharedIdentity: {
    providerInstanceId: string;
    clientType: 'public' | 'confidential';
  };
  /** POST /api/v1/instances/{instanceId}/dispatches */
  createDispatch: {
    action?: 'apply' | 'check' | 'drift' | 'suspend' | 'export';
    environment?: string;
  };
  /** POST /api/v1/instances */
  createInstance: {
    teamId: string;
    name: string;
    /** Catalog identifier, e.g. starter-web */
    template: string;
    /** An installed hosting provider identifier. */
    provider?: string;
    templateRef?: {
      repo: string;
      commitSha: string;
    };
  };
  /** POST /api/v1/teams/{teamId}/invitations */
  createInvitation: {
    email: string;
    role?: 'owner' | 'member';
    ttlDays?: number;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/platforms */
  createMarketplacePlatform: MarketplacePlatformCreation;
  /** POST /api/v1/instances/{instanceId}/notification-rules */
  createNotificationRule: {
    event: 'deployment-failed' | 'app-outage' | 'secret-updated';
    enabled: boolean;
    environment?: string;
  };
  /** POST /api/v1/teams */
  createTeam: {
    name: Slug;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/connection */
  enrollPrivateMarketplaceConnection: {
    handoff: string;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch/openbao */
  initializeStarterOpenBao: {
    publicKey: string;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/pulls */
  issueMarketplacePullGrant: MarketplacePlatformAcquisitionInput;
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/uploads */
  issueMarketplaceUploadGrant: MarketplaceArtifactVersion;
  /** POST /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId}/maintenance */
  maintainHubInstallation: ({
    action: 'update';
    environment: 'staging' | 'production';
    revision: string;
  } | {
    action: 'wipe';
    confirmation: string;
  });
  /** POST /api/v1/attestations */
  postAttestation: Attestation;
  /** POST /api/v1/teams/{teamId}/marketplace/installs */
  preparePrivateMarketplaceInstall: MarketplaceInstallInput;
  /** POST /api/v1/instances/{instanceId}/capability */
  publishCapability: {
    capability: string;
    outputs?: Array<{
      output: string;
      kind: 'url' | 'value' | 'secret';
      state?: 'not-issued' | 'issued-and-placed' | 'placement-unknown' | 're-issue-required';
    }>;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/bundles */
  publishMarketplaceArtifactBundle: MarketplaceBundlePublication;
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/releases */
  publishMarketplacePlatformRelease: MarketplacePlatformPublication;
  /** POST /api/v1/teams/{teamId}/marketplace/releases */
  publishMarketplaceRelease: MarketplaceReleasePublication;
  /** PUT /api/v1/instances/{instanceId}/plan */
  putPlan: {
    /** An InfraPlan, whose own `planHash` is the authority. Carries topology and digests; never a credential value (D4). */
    plan: Record<string, never>;
  };
  /** PUT /api/v1/instances/{instanceId}/secrets/{name} */
  putSecret: {
    service: string;
    environment: string;
    /** The credential. Never returned by any endpoint; never written to the audit record. */
    value: string;
    /** What the write does to the RUNNING service. The default, `suppress`, writes the variable and leaves the container alone -- the behaviour every delivery had before this field existed, and still the default, because a platform that cannot read a value back (D4) must not silently restart things on a write that changed nothing. `auto` sends the write without Railway's `skipDeploys` suppression and lets the provider's own comparison decide. Measured 2026-11-15 in docs/research/: a changed value started a new deployment on its own; an identical value started nothing. So the restart is triggered by the party that holds the value, and platfolio never stores, reads, or hashes one -- which is the tradeoff this design accepts in exchange for keeping D4 intact. */
    refresh?: 'suppress' | 'auto';
  };
  /** POST /api/v1/marketplace/installations/{installationId}/enrollment */
  redeemMarketplaceEnrollment: {
    registryDigest: string;
  };
  /** POST /api/v1/instances/{instanceId}/redeploy */
  redeployInstance: {
    environment: 'production' | 'staging' | 'preview';
    service?: string;
  };
  /** POST /api/v1/instances/{instanceId}/plan/from-repository */
  registerPlanFromRepository: {
    /** Manifest location within the repository. Default `compose.yaml`. */
    path?: string;
    /** The pinned production overlay. Default `compose.prod.yaml`. Absent is allowed only when every service in `path` already carries a digest; otherwise the refusal says which service is unpinned. */
    overlayPath?: string;
    /** Environments to plan. Omit to include every enabled environment. */
    environments?: ('staging' | 'production')[];
  };
  /** POST /api/v1/instances/{instanceId}/hosting/removal */
  removeInstanceHosting: HostingRemovalRequest;
  /** POST /api/v1/teams/{teamId}/starter-launch/remove */
  removeStarterLaunch: {
    data: 'keep' | 'wipe';
    confirmation?: string;
  };
  /** POST /api/v1/instances/{instanceId}/artifacts */
  reportArtifact: {
    /** The compose service name this artifact belongs to. */
    service: string;
    /** Repository without tag or digest, e.g. `ghcr.io/acme/widget`. */
    image: string;
    /** The immutable identity. A tag is not accepted, because a tag is a thing that moves. */
    digest: string;
    /** Commit the artifact was built from, when the builder knows it. */
    sourceRef?: string;
    version?: string;
  };
  /** PUT /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/maintenance */
  setMarketplaceMaintenance: MarketplaceMaintenanceInput;
  /** PUT /api/v1/instances/{instanceId}/capability/{capability}/shares */
  shareCapability: {
    /** A team id, or `*` to offer it to every team. Recorded, never implied. */
    toTeamId: string;
  };
  /** PUT /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId} */
  startHubInstallation: InstallationLaunchInput;
  /** POST /api/v1/teams/{teamId}/starter-launch */
  startStarterLaunch: {
    release?: MarketplaceReleaseSelection;
    /** Shared Identity bootstrap material encrypted to the private worker for first setup. Restoring a verified installation uses its existing database and credentials. */
    bootstrap?: string;
  };
  /** POST /api/v1/instances/{instanceId}/dispatches/{dispatchId}/trigger */
  triggerDispatch: {
    /** Branch or tag GitHub should run on. Not the plan's commit: a workflow run belongs to a branch, and the digest it must satisfy travels as an input. */
    ref: string;
    /** Workflow file name. Default `platfolio-managed.yml`. */
    workflow?: string;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch/openbao/unlock */
  unlockStarterOpenBao: {
    recovery: string;
  };
  /** PUT /api/v1/me/profile */
  updateAccountProfile: {
    username: string;
    displayName: string;
  };
  /** PUT /api/v1/instances/{instanceId}/environments/{environment}/configuration/starter-brand */
  updateHostedStarterBrand: StarterBrandChange;
  /** PUT /api/v1/me/notification-email */
  updateMyNotificationEmail: {
    enabled: boolean;
  };
  /** PUT /api/v1/instances/{instanceId}/notification-rules/{ruleId} */
  updateNotificationRule: {
    event: 'deployment-failed' | 'app-outage' | 'secret-updated';
    enabled: boolean;
    environment?: string;
  };
  /** PATCH /api/v1/teams/{teamId}/members/{personId} */
  updateTeamMemberRole: {
    role: 'owner' | 'member';
  };
}

/**
 * Every response body the spec declares, per operation and status code. A status with no content -- the 204
 * that secret delivery answers with -- is `void`: the spec says there is no body, which is a different claim
 * from an unchecked one.
 *
 * GENERATED -- `pnpm run api:types:check` fails if this file stops reproducing from the committed spec.
 */
export interface ApiResponses {
  /** POST /api/v1/me/invitations/{invitationId}/accept */
  acceptInvitation: {
    '200': {
      teamId: string;
      role: 'owner' | 'member';
      personId: string;
    };
    '401': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/bundle-acquisitions */
  acquireMarketplaceArtifactRelease: {
    '200': MarketplaceArtifactAcquisition;
    '400': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/acquisitions */
  acquireMarketplacePlatformRelease: {
    '200': MarketplacePlatformAcquisition;
    '400': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** POST /api/v1/instances/{instanceId}/hosting/apply */
  applyInstanceHostingPlan: {
    '200': ApplyResult;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** PUT /api/v1/instances/{instanceId}/environments/{environment}/custom-domains/{hostname} */
  attachHostedCustomDomain: {
    '200': HostedCustomDomain;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/installation-launches */
  authorizeHubInstallation: {
    '201': {
      id: string;
      authorizationUrl: string;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch/railway */
  beginStarterRailwayAuthorization: {
    '200': {
      authorizationUrl: string;
    };
    '401': Error;
    '403': Error;
    '404': Error;
    '503': Error;
  };
  /** PUT /api/v1/instances/{instanceId}/bindings/{capability} */
  bindCapability: {
    '200': BindingRecord;
    '400': Error;
    '401': Error;
    '404': Error;
  };
  /** PUT /api/v1/instances/{instanceId}/bindings/identity/intent */
  bindSharedIdentity: {
    '200': BindingRecord;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/claim */
  claimEnrolledMarketplaceRelease: {
    '200': {
      installationId: string;
      template: 'starter-web';
      repo: string;
      version: string;
      revision: string;
      priceMinor: 0;
    };
    '400': Error;
    '404': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/installations/{installationId}/claim */
  claimFreeMarketplaceRelease: {
    '200': {
      installationId: string;
      template: 'starter-web';
      repo: string;
      version: string;
      revision: string;
      priceMinor: 0;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** GET /api/v1/hosting/installation-authorization/callback */
  completeHubInstallationAuthorization: {
    '303': void;
    '404': Error;
  };
  /** GET /api/v1/railway/callback */
  completeStarterRailwayAuthorization: {
    '303': void;
    '404': Error;
  };
  /** PUT /api/v1/teams/{teamId}/marketplace/installations/{installationId} */
  connectMarketplaceInstallation: {
    '204': void;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** POST /api/v1/instances/{instanceId}/dispatches */
  createDispatch: {
    '201': {
      intent: DispatchIntent;
    };
    '400': Error;
    '401': Error;
    '404': Error;
  };
  /** POST /api/v1/instances */
  createInstance: {
    '201': Instance;
    '400': Error;
    '401': Error;
    '404': Error;
  };
  /** POST /api/v1/teams/{teamId}/invitations */
  createInvitation: {
    '201': {
      invitation: Invitation;
      delivery: {
        sent: boolean;
        reason?: string;
      };
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/platforms */
  createMarketplacePlatform: {
    '201': MarketplacePublisherPlatform;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/instances/{instanceId}/notification-rules */
  createNotificationRule: {
    '201': NotificationRule;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/teams */
  createTeam: {
    '201': TeamWithRole;
    '400': Error;
    '401': Error;
    '409': Error;
  };
  /** DELETE /api/v1/instances/{instanceId}/notification-rules/{ruleId} */
  deleteNotificationRule: {
    '204': void;
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** DELETE /api/v1/instances/{instanceId} */
  destroyInstance: {
    '202': {
      instanceId: string;
      state: 'deprovisioning';
      recorded: true;
    };
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** DELETE /api/v1/instances/{instanceId}/environments/{environment}/custom-domains/{hostname} */
  detachHostedCustomDomain: {
    '204': void;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** DELETE /api/v1/teams/{teamId}/marketplace/installations/{installationId} */
  disconnectMarketplaceInstallation: {
    '204': void;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/connection */
  enrollPrivateMarketplaceConnection: {
    '204': void;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** GET /api/v1/me/profile */
  getAccountProfile: {
    '200': {
      username: string;
      displayName: string;
      email: string;
      emailVerified: boolean;
    };
    '401': Error;
    '403': Error;
    '503': Error;
  };
  /** GET /api/v1/me */
  getCurrentPerson: {
    '200': CurrentPerson;
    '401': Error;
  };
  /** GET /api/v1/instances/{instanceId}/dispatches/{dispatchId} */
  getDispatchPlan: {
    '200': {
      plan: Record<string, never>;
      planHash: string;
      issuedAt: string;
      expiresAt: string;
    };
    '401': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/catalog */
  getEnrolledMarketplaceCatalog: {
    '200': MarketplaceRelease[];
    '400': Error;
    '404': Error;
  };
  /** GET /healthz */
  getHealth: {
    '200': Health;
  };
  /** GET /api/v1/instances/{instanceId}/status */
  getHostedAppStatus: {
    '200': {
      environment: 'staging';
      state: 'checking' | 'up' | 'down' | 'paused' | 'removed';
      checkedAt?: string;
      updates: Array<{
        id: string;
        at: string;
        state: 'down' | 'up' | 'paused' | 'removed';
      }>;
    };
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** GET /api/v1/instances/{instanceId}/environments/{environment}/configuration/starter-brand */
  getHostedStarterBrand: {
    '200': {
      value: (string | null);
      state: 'ready' | 'deploying' | 'failed';
    };
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** GET /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId} */
  getHubInstallationLaunch: {
    '200': HubInstallationLaunch;
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** GET /api/v1/teams/{teamId}/marketplace/installation-offer */
  getHubInstallationOffer: {
    '200': {
      provider: string;
      revision: string;
    };
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** GET /api/v1/instances/{instanceId} */
  getInstance: {
    '200': InstanceResponse;
    '401': Error;
    '404': Error;
  };
  /** GET /api/v1/instances/{instanceId}/environments/{environment} */
  getInstanceEnvironment: {
    '200': {
      planned: boolean;
      hosting?: HostedStarter;
      services: Array<{
        name: string;
        secrets: string[];
      }>;
      domains: Array<{
        host: string;
        service: string;
      }>;
      deployments: Array<{
        id: string;
        result: 'ok' | 'partial' | 'failed' | 'noop';
        reportedAt: string;
        commit?: string;
        problem?: string;
      }>;
    };
    '401': Error;
    '404': Error;
  };
  /** GET /api/v1/instances/{instanceId}/hosting */
  getInstanceHostingState: {
    '200': StateSnapshot;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** GET /api/v1/instances/{instanceId}/latest-attestation */
  getLatestAttestation: {
    '200': AttestationRecord;
    '401': Error;
    '404': Error;
  };
  /** GET /api/v1/me/notification-email */
  getMyNotificationEmail: {
    '200': {
      available: boolean;
      enabled: boolean;
    };
    '401': Error;
    '403': Error;
    '503': Error;
  };
  /** GET /api/v1/teams/{teamId}/marketplace/connection */
  getPrivateMarketplaceConnection: {
    '200': {
      state: 'unconfigured' | 'openbao-required' | 'disconnected' | 'connected' | 'unavailable';
      release?: {
        template: string;
        version: string;
        revision: string;
      };
    };
    '401': Error;
    '403': Error;
    '404': Error;
    '503': Error;
  };
  /** GET /api/v1/marketplace/catalog */
  getPublicMarketplaceCatalog: {
    '200': MarketplaceRelease[];
    '503': Error;
  };
  /** GET /readyz */
  getReady: {
    '200': Ready;
    '503': Ready;
  };
  /** GET /api/v1/teams/{teamId}/starter-launch */
  getStarterLaunch: {
    '200': {
      state: 'idle' | 'running' | 'ready' | 'failed' | 'removing' | 'kept' | 'wiped';
      template: string;
      revision: string;
      version?: string;
      registration?: 'pending' | 'recorded' | 'conflict';
      instanceName?: string;
      projectId?: string;
      /** The project identified by the verified permanent removal receipt. */
      removedProjectId?: string;
      deploymentId?: string;
      origin?: string;
      retainedVolumes: string[];
      events: Array<{
        at: string;
        step: string;
        state: string;
        resourceId?: string;
        detail?: string;
      }>;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '503': Error;
  };
  /** GET /api/v1/teams/{teamId}/starter-launch/setup */
  getStarterLaunchSetup: {
    '200': {
      openBao: 'unreachable' | 'uninitialized' | 'sealed' | 'setup-required' | 'ready';
      railway: 'connect' | 'connected';
      workerKey: string;
      canWipeData?: boolean;
    };
    '401': Error;
    '403': Error;
    '404': Error;
    '503': Error;
  };
  /** GET /status */
  getStatus: {
    '200': {
      status: 'ok';
    };
  };
  /** GET /version */
  getVersion: {
    '200': Version;
  };
  /** GET /api/v1/whoami */
  getWhoami: {
    '200': Whoami;
    '401': Error;
    '403': Error;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch/openbao */
  initializeStarterOpenBao: {
    '200': {
      recovery: string;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '503': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/installations/{installationId}/enrollment */
  issueMarketplaceEnrollment: {
    '201': {
      enrollmentCode: string;
      expiresAt: string;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/pulls */
  issueMarketplacePullGrant: {
    '200': MarketplaceArtifactGrant;
    '400': Error;
    '404': Error;
    '503': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/uploads */
  issueMarketplaceUploadGrant: {
    '200': MarketplaceArtifactGrant;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '503': Error;
  };
  /** GET /api/v1/audit */
  listAudit: {
    '200': AuditEntry[];
    '400': Error;
    '401': Error;
  };
  /** GET /api/v1/capabilities */
  listAvailableCapabilities: {
    '200': CapabilityOffer[];
    '401': Error;
  };
  /** GET /api/v1/instances/{instanceId}/bindings */
  listBindings: {
    '200': BindingRecord[];
    '401': Error;
    '404': Error;
  };
  /** GET /api/v1/instances/{instanceId}/consumers */
  listConsumers: {
    '200': BindingRecord[];
    '401': Error;
    '404': Error;
  };
  /** GET /api/v1/instances/{instanceId}/environments/{environment}/custom-domains */
  listHostedCustomDomains: {
    '200': HostedCustomDomain[];
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** GET /api/v1/teams/{teamId}/marketplace/installation-launches */
  listHubInstallationLaunches: {
    '200': HubInstallationJournal[];
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** GET /api/v1/templates */
  listInstallableTemplates: {
    '200': MarketplaceRelease[];
    '401': Error;
    '403': Error;
    '503': Error;
  };
  /** GET /api/v1/instances */
  listInstances: {
    '200': InstanceResponse[];
    '401': Error;
  };
  /** GET /api/v1/teams/{teamId}/invitations */
  listInvitations: {
    '200': Invitation[];
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** GET /api/v1/teams/{teamId}/marketplace/installations */
  listMarketplaceInstallations: {
    '200': MarketplaceInstallation[];
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** GET /api/v1/marketplace/platforms/{platformId}/releases */
  listMarketplacePlatformReleases: {
    '200': MarketplacePlatformRelease[];
    '404': Error;
    '503': Error;
  };
  /** GET /api/v1/marketplace/platforms */
  listMarketplacePlatforms: {
    '200': MarketplacePlatform[];
    '404': Error;
    '503': Error;
  };
  /** GET /api/v1/me/invitations */
  listMyInvitations: {
    '200': Invitation[];
    '401': Error;
    '409': Error;
  };
  /** GET /api/v1/me/notifications */
  listMyNotifications: {
    '200': {
      rules: NotificationRule[];
      updates: Array<{
        id: string;
        instanceId: string;
        event: 'deployment-failed' | 'app-outage' | 'secret-updated';
        at: string;
        environment?: string;
      }>;
    };
    '401': Error;
    '403': Error;
  };
  /** GET /api/v1/instances/{instanceId}/secrets */
  listSecretPresence: {
    '200': {
      instanceId: string;
      environment: string;
      service: string;
      presence: Array<{
        name: string;
        state: 'set' | 'missing' | 'unverifiable';
      }>;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '501': Error;
  };
  /** GET /api/v1/teams/{teamId}/activity */
  listTeamActivity: {
    '200': AuditEntry[];
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** GET /api/v1/teams/{teamId}/members */
  listTeamMembers: {
    '200': Array<{
      personId: string;
      role: 'owner' | 'member';
      addedAt: string;
      self: boolean;
      invitedAddress?: string;
    }>;
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** GET /api/v1/teams */
  listTeams: {
    '200': Array<{
      teamId: string;
      name: Slug;
      role: 'owner' | 'member';
    }>;
    '401': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId}/maintenance */
  maintainHubInstallation: {
    '202': HubInstallationLaunch;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/attestations */
  postAttestation: {
    '202': {
      accepted: true;
      dispatchId: string;
      result: 'ok' | 'partial' | 'failed' | 'noop';
    };
    '400': Error;
    '401': Error;
    '409': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/installs */
  preparePrivateMarketplaceInstall: {
    '200': MarketplaceInstall;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** POST /api/v1/instances/{instanceId}/capability */
  publishCapability: {
    '200': CapabilityOffer;
    '400': Error;
    '401': Error;
    '404': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/bundles */
  publishMarketplaceArtifactBundle: {
    '200': MarketplacePlatformRelease;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/releases */
  publishMarketplacePlatformRelease: {
    '200': MarketplacePlatformRelease;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/teams/{teamId}/marketplace/releases */
  publishMarketplaceRelease: {
    '204': void;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** PUT /api/v1/instances/{instanceId}/capability/identity */
  publishSharedIdentityCapability: {
    '200': CapabilityOffer;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** PUT /api/v1/instances/{instanceId}/plan */
  putPlan: {
    '200': {
      instanceId: string;
      planHash: string;
    };
    '400': Error;
    '401': Error;
    '404': Error;
  };
  /** PUT /api/v1/instances/{instanceId}/secrets/{name} */
  putSecret: {
    '204': void;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '501': Error;
    '502': Error;
    '503': Error;
  };
  /** POST /api/v1/marketplace/installations/{installationId}/enrollment */
  redeemMarketplaceEnrollment: {
    '204': void;
    '400': Error;
    '404': Error;
  };
  /** POST /api/v1/instances/{instanceId}/environments/{environment}/deployments */
  redeployHostedStarter: {
    '202': {
      state: 'requested';
    };
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** POST /api/v1/instances/{instanceId}/redeploy */
  redeployInstance: {
    '202': {
      instanceId: string;
      environment: string;
      /** Physical names the provider was asked to redeploy, in the order it acted. */
      services: string[];
      /** Names it could not act on -- no such service, no instance here, or a deploy the provider accepted without starting. */
      refused: Array<{
        service: string;
        code: 'no-project' | 'no-environment' | 'no-service' | 'not-in-environment' | 'deployment-unchanged';
        reason: string;
      }>;
      /** Names suppressed because the provider's deploy ceiling was already spent. Distinct from `refused`: this is "not allowed to", not "nothing there". */
      budgetSkipped: string[];
      /** True only when every service asked about was observed to have a NEW deployment id. */
      verified: boolean;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '501': {
      error: 'provider-cannot-redeploy';
      message: string;
    };
    '502': Error;
  };
  /** POST /api/v1/instances/{instanceId}/plan/from-repository */
  registerPlanFromRepository: {
    '200': {
      instanceId: string;
      planHash: string;
      source: {
        repo: string;
        ref: string;
        /** Every file that contributed to the plan, with GitHub's blob identity. */
        files: Array<{
          path: string;
          blobSha: string;
          size?: number;
        }>;
      };
      summary: {
        services: number;
        databases?: number;
        environments: string[];
      };
      /** Non-fatal truths the caller must see -- an unpinned public image, a reference the provider could not verify. Never used to soften a failure into a pass. */
      warnings?: Array<{
        code: string;
        message: string;
      }>;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '503': Error;
  };
  /** POST /api/v1/instances/{instanceId}/hosting/removal */
  removeInstanceHosting: {
    '200': DeleteResult;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch/remove */
  removeStarterLaunch: {
    '200': {
      state: 'idle' | 'running' | 'ready' | 'failed' | 'removing' | 'kept' | 'wiped';
      template: string;
      revision: string;
      version?: string;
      registration?: 'pending' | 'recorded' | 'conflict';
      instanceName?: string;
      projectId?: string;
      /** The project identified by the verified permanent removal receipt. */
      removedProjectId?: string;
      deploymentId?: string;
      origin?: string;
      retainedVolumes: string[];
      events: Array<{
        at: string;
        step: string;
        state: string;
        resourceId?: string;
        detail?: string;
      }>;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** DELETE /api/v1/teams/{teamId}/members/{personId} */
  removeTeamMember: {
    '204': void;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/instances/{instanceId}/artifacts */
  reportArtifact: {
    '201': {
      instanceId: string;
      service: string;
      image: string;
      digest: string;
      reportedAt: string;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** DELETE /api/v1/instances/{instanceId}/capability/{capability}/shares/{toTeamId} */
  revokeCapabilityShare: {
    '200': {
      revoked: true;
    };
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** DELETE /api/v1/teams/{teamId}/invitations/{invitationId} */
  revokeInvitation: {
    '204': void;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** PUT /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/maintenance */
  setMarketplaceMaintenance: {
    '204': void;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '503': Error;
  };
  /** PUT /api/v1/instances/{instanceId}/capability/{capability}/shares */
  shareCapability: {
    '200': CapabilityShare;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** PUT /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId} */
  startHubInstallation: {
    '202': HubInstallationLaunch;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch */
  startStarterLaunch: {
    '200': {
      state: 'idle' | 'running' | 'ready' | 'failed' | 'removing' | 'kept' | 'wiped';
      template: string;
      revision: string;
      version?: string;
      registration?: 'pending' | 'recorded' | 'conflict';
      instanceName?: string;
      projectId?: string;
      /** The project identified by the verified permanent removal receipt. */
      removedProjectId?: string;
      deploymentId?: string;
      origin?: string;
      retainedVolumes: string[];
      events: Array<{
        at: string;
        step: string;
        state: string;
        resourceId?: string;
        detail?: string;
      }>;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** POST /api/v1/instances/{instanceId}/dispatches/{dispatchId}/trigger */
  triggerDispatch: {
    '202': {
      instanceId: string;
      dispatchId: string;
      repo: string;
      ref: string;
      workflow: string;
      state: 'requested';
    };
    '400': Error;
    '401': Error;
    '404': Error;
    '409': Error;
    '502': Error;
    '503': Error;
  };
  /** DELETE /api/v1/instances/{instanceId}/bindings/{capability} */
  unbindCapability: {
    '204': void;
    '401': Error;
    '404': Error;
  };
  /** POST /api/v1/teams/{teamId}/starter-launch/openbao/unlock */
  unlockStarterOpenBao: {
    '204': void;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '503': Error;
  };
  /** PUT /api/v1/me/profile */
  updateAccountProfile: {
    '200': {
      username: string;
      displayName: string;
      email: string;
      emailVerified: boolean;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '503': Error;
  };
  /** PUT /api/v1/instances/{instanceId}/environments/{environment}/configuration/starter-brand */
  updateHostedStarterBrand: {
    '202': {
      state: 'requested';
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
    '503': Error;
  };
  /** PUT /api/v1/me/notification-email */
  updateMyNotificationEmail: {
    '200': {
      available: boolean;
      enabled: boolean;
    };
    '400': Error;
    '401': Error;
    '403': Error;
    '503': Error;
  };
  /** PUT /api/v1/instances/{instanceId}/notification-rules/{ruleId} */
  updateNotificationRule: {
    '200': NotificationRule;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
  /** PATCH /api/v1/teams/{teamId}/members/{personId} */
  updateTeamMemberRole: {
    '204': void;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
    '409': Error;
  };
}

/** Every operationId in the document -- the key type of the three maps above. */
export type OperationId = keyof ApiResponses;

/** The request body of one operation, or `undefined` where the spec declares none. */
export type RequestBodyOf<O extends OperationId> = O extends keyof ApiRequestBodies ? ApiRequestBodies[O] : undefined;

/** The path and query parameters of one operation, or an empty record where it takes none. */
export type ParamsOf<O extends OperationId> = O extends keyof ApiParameters ? ApiParameters[O] : Record<string, never>;

/** The body type the spec declares for one operation at one status. */
export type ResponseOf<O extends OperationId, S extends keyof ApiResponses[O]> = ApiResponses[O][S];

/** The 2xx status codes one operation declares, exactly as the map writes them: quoted three-digit strings. */
export type SuccessStatuses<O extends OperationId> = Extract<keyof ApiResponses[O], '200' | '201' | '202' | '204'>;

/** The success body of an operation -- whatever its declared 2xx statuses produce, unionled. */
export type SuccessOf<O extends OperationId> = { [S in SuccessStatuses<O>]: ApiResponses[O][S] }[SuccessStatuses<O>];

/**
 * The HTTP methods a path item may be written under, spelled as the document spells them.
 *
 * The key of the path item, lowercase: this is the document's own notation, not the wire form, and a
 * transport upper-cases it when it builds the request rather than the generator inventing a second
 * spelling of the same verb.
 */
export type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace';

/**
 * One operation's route: the verb it answers to, and the path as the spec wrote it.
 */
export interface Endpoint {
  readonly method: HttpMethod;
  /** The spec's own notation, so `{instanceId}` matches rather than `:instanceId`. */
  readonly path: string;
}

/**
 * Every operationId, mapped to the method and templated path the document gives it.
 *
 * `satisfies Record<OperationId, Endpoint>` is the rule, not a style choice: an operation the document
 * declares and this table lacks is a compile error, and an entry whose operation has left the document
 * is a compile error too (`pnpm run api:types:check` then refuses the file from the other side, because
 * the table no longer reproduces from the spec). A transport therefore never has to ask whether the
 * routes are complete -- the type it reads was built by checking that.
 *
 * GENERATED -- `pnpm run api:types:check` fails if this file stops reproducing from the committed spec.
 */
export const ENDPOINTS = {
  /** POST /api/v1/me/invitations/{invitationId}/accept */
  acceptInvitation: { method: 'post', path: '/api/v1/me/invitations/{invitationId}/accept' },
  /** POST /api/v1/marketplace/installations/{installationId}/bundle-acquisitions */
  acquireMarketplaceArtifactRelease: { method: 'post', path: '/api/v1/marketplace/installations/{installationId}/bundle-acquisitions' },
  /** POST /api/v1/marketplace/installations/{installationId}/acquisitions */
  acquireMarketplacePlatformRelease: { method: 'post', path: '/api/v1/marketplace/installations/{installationId}/acquisitions' },
  /** POST /api/v1/instances/{instanceId}/hosting/apply */
  applyInstanceHostingPlan: { method: 'post', path: '/api/v1/instances/{instanceId}/hosting/apply' },
  /** PUT /api/v1/instances/{instanceId}/environments/{environment}/custom-domains/{hostname} */
  attachHostedCustomDomain: { method: 'put', path: '/api/v1/instances/{instanceId}/environments/{environment}/custom-domains/{hostname}' },
  /** POST /api/v1/teams/{teamId}/marketplace/installation-launches */
  authorizeHubInstallation: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/installation-launches' },
  /** POST /api/v1/teams/{teamId}/starter-launch/railway */
  beginStarterRailwayAuthorization: { method: 'post', path: '/api/v1/teams/{teamId}/starter-launch/railway' },
  /** PUT /api/v1/instances/{instanceId}/bindings/{capability} */
  bindCapability: { method: 'put', path: '/api/v1/instances/{instanceId}/bindings/{capability}' },
  /** PUT /api/v1/instances/{instanceId}/bindings/identity/intent */
  bindSharedIdentity: { method: 'put', path: '/api/v1/instances/{instanceId}/bindings/identity/intent' },
  /** POST /api/v1/marketplace/installations/{installationId}/claim */
  claimEnrolledMarketplaceRelease: { method: 'post', path: '/api/v1/marketplace/installations/{installationId}/claim' },
  /** POST /api/v1/teams/{teamId}/marketplace/installations/{installationId}/claim */
  claimFreeMarketplaceRelease: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/installations/{installationId}/claim' },
  /** GET /api/v1/hosting/installation-authorization/callback */
  completeHubInstallationAuthorization: { method: 'get', path: '/api/v1/hosting/installation-authorization/callback' },
  /** GET /api/v1/railway/callback */
  completeStarterRailwayAuthorization: { method: 'get', path: '/api/v1/railway/callback' },
  /** PUT /api/v1/teams/{teamId}/marketplace/installations/{installationId} */
  connectMarketplaceInstallation: { method: 'put', path: '/api/v1/teams/{teamId}/marketplace/installations/{installationId}' },
  /** POST /api/v1/instances/{instanceId}/dispatches */
  createDispatch: { method: 'post', path: '/api/v1/instances/{instanceId}/dispatches' },
  /** POST /api/v1/instances */
  createInstance: { method: 'post', path: '/api/v1/instances' },
  /** POST /api/v1/teams/{teamId}/invitations */
  createInvitation: { method: 'post', path: '/api/v1/teams/{teamId}/invitations' },
  /** POST /api/v1/teams/{teamId}/marketplace/platforms */
  createMarketplacePlatform: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/platforms' },
  /** POST /api/v1/instances/{instanceId}/notification-rules */
  createNotificationRule: { method: 'post', path: '/api/v1/instances/{instanceId}/notification-rules' },
  /** POST /api/v1/teams */
  createTeam: { method: 'post', path: '/api/v1/teams' },
  /** DELETE /api/v1/instances/{instanceId}/notification-rules/{ruleId} */
  deleteNotificationRule: { method: 'delete', path: '/api/v1/instances/{instanceId}/notification-rules/{ruleId}' },
  /** DELETE /api/v1/instances/{instanceId} */
  destroyInstance: { method: 'delete', path: '/api/v1/instances/{instanceId}' },
  /** DELETE /api/v1/instances/{instanceId}/environments/{environment}/custom-domains/{hostname} */
  detachHostedCustomDomain: { method: 'delete', path: '/api/v1/instances/{instanceId}/environments/{environment}/custom-domains/{hostname}' },
  /** DELETE /api/v1/teams/{teamId}/marketplace/installations/{installationId} */
  disconnectMarketplaceInstallation: { method: 'delete', path: '/api/v1/teams/{teamId}/marketplace/installations/{installationId}' },
  /** POST /api/v1/teams/{teamId}/marketplace/connection */
  enrollPrivateMarketplaceConnection: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/connection' },
  /** GET /api/v1/me/profile */
  getAccountProfile: { method: 'get', path: '/api/v1/me/profile' },
  /** GET /api/v1/me */
  getCurrentPerson: { method: 'get', path: '/api/v1/me' },
  /** GET /api/v1/instances/{instanceId}/dispatches/{dispatchId} */
  getDispatchPlan: { method: 'get', path: '/api/v1/instances/{instanceId}/dispatches/{dispatchId}' },
  /** POST /api/v1/marketplace/installations/{installationId}/catalog */
  getEnrolledMarketplaceCatalog: { method: 'post', path: '/api/v1/marketplace/installations/{installationId}/catalog' },
  /** GET /healthz */
  getHealth: { method: 'get', path: '/healthz' },
  /** GET /api/v1/instances/{instanceId}/status */
  getHostedAppStatus: { method: 'get', path: '/api/v1/instances/{instanceId}/status' },
  /** GET /api/v1/instances/{instanceId}/environments/{environment}/configuration/starter-brand */
  getHostedStarterBrand: { method: 'get', path: '/api/v1/instances/{instanceId}/environments/{environment}/configuration/starter-brand' },
  /** GET /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId} */
  getHubInstallationLaunch: { method: 'get', path: '/api/v1/teams/{teamId}/marketplace/installation-launches/{launchId}' },
  /** GET /api/v1/teams/{teamId}/marketplace/installation-offer */
  getHubInstallationOffer: { method: 'get', path: '/api/v1/teams/{teamId}/marketplace/installation-offer' },
  /** GET /api/v1/instances/{instanceId} */
  getInstance: { method: 'get', path: '/api/v1/instances/{instanceId}' },
  /** GET /api/v1/instances/{instanceId}/environments/{environment} */
  getInstanceEnvironment: { method: 'get', path: '/api/v1/instances/{instanceId}/environments/{environment}' },
  /** GET /api/v1/instances/{instanceId}/hosting */
  getInstanceHostingState: { method: 'get', path: '/api/v1/instances/{instanceId}/hosting' },
  /** GET /api/v1/instances/{instanceId}/latest-attestation */
  getLatestAttestation: { method: 'get', path: '/api/v1/instances/{instanceId}/latest-attestation' },
  /** GET /api/v1/me/notification-email */
  getMyNotificationEmail: { method: 'get', path: '/api/v1/me/notification-email' },
  /** GET /api/v1/teams/{teamId}/marketplace/connection */
  getPrivateMarketplaceConnection: { method: 'get', path: '/api/v1/teams/{teamId}/marketplace/connection' },
  /** GET /api/v1/marketplace/catalog */
  getPublicMarketplaceCatalog: { method: 'get', path: '/api/v1/marketplace/catalog' },
  /** GET /readyz */
  getReady: { method: 'get', path: '/readyz' },
  /** GET /api/v1/teams/{teamId}/starter-launch */
  getStarterLaunch: { method: 'get', path: '/api/v1/teams/{teamId}/starter-launch' },
  /** GET /api/v1/teams/{teamId}/starter-launch/setup */
  getStarterLaunchSetup: { method: 'get', path: '/api/v1/teams/{teamId}/starter-launch/setup' },
  /** GET /status */
  getStatus: { method: 'get', path: '/status' },
  /** GET /version */
  getVersion: { method: 'get', path: '/version' },
  /** GET /api/v1/whoami */
  getWhoami: { method: 'get', path: '/api/v1/whoami' },
  /** POST /api/v1/teams/{teamId}/starter-launch/openbao */
  initializeStarterOpenBao: { method: 'post', path: '/api/v1/teams/{teamId}/starter-launch/openbao' },
  /** POST /api/v1/teams/{teamId}/marketplace/installations/{installationId}/enrollment */
  issueMarketplaceEnrollment: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/installations/{installationId}/enrollment' },
  /** POST /api/v1/marketplace/installations/{installationId}/pulls */
  issueMarketplacePullGrant: { method: 'post', path: '/api/v1/marketplace/installations/{installationId}/pulls' },
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/uploads */
  issueMarketplaceUploadGrant: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/platforms/{platformId}/uploads' },
  /** GET /api/v1/audit */
  listAudit: { method: 'get', path: '/api/v1/audit' },
  /** GET /api/v1/capabilities */
  listAvailableCapabilities: { method: 'get', path: '/api/v1/capabilities' },
  /** GET /api/v1/instances/{instanceId}/bindings */
  listBindings: { method: 'get', path: '/api/v1/instances/{instanceId}/bindings' },
  /** GET /api/v1/instances/{instanceId}/consumers */
  listConsumers: { method: 'get', path: '/api/v1/instances/{instanceId}/consumers' },
  /** GET /api/v1/instances/{instanceId}/environments/{environment}/custom-domains */
  listHostedCustomDomains: { method: 'get', path: '/api/v1/instances/{instanceId}/environments/{environment}/custom-domains' },
  /** GET /api/v1/teams/{teamId}/marketplace/installation-launches */
  listHubInstallationLaunches: { method: 'get', path: '/api/v1/teams/{teamId}/marketplace/installation-launches' },
  /** GET /api/v1/templates */
  listInstallableTemplates: { method: 'get', path: '/api/v1/templates' },
  /** GET /api/v1/instances */
  listInstances: { method: 'get', path: '/api/v1/instances' },
  /** GET /api/v1/teams/{teamId}/invitations */
  listInvitations: { method: 'get', path: '/api/v1/teams/{teamId}/invitations' },
  /** GET /api/v1/teams/{teamId}/marketplace/installations */
  listMarketplaceInstallations: { method: 'get', path: '/api/v1/teams/{teamId}/marketplace/installations' },
  /** GET /api/v1/marketplace/platforms/{platformId}/releases */
  listMarketplacePlatformReleases: { method: 'get', path: '/api/v1/marketplace/platforms/{platformId}/releases' },
  /** GET /api/v1/marketplace/platforms */
  listMarketplacePlatforms: { method: 'get', path: '/api/v1/marketplace/platforms' },
  /** GET /api/v1/me/invitations */
  listMyInvitations: { method: 'get', path: '/api/v1/me/invitations' },
  /** GET /api/v1/me/notifications */
  listMyNotifications: { method: 'get', path: '/api/v1/me/notifications' },
  /** GET /api/v1/instances/{instanceId}/secrets */
  listSecretPresence: { method: 'get', path: '/api/v1/instances/{instanceId}/secrets' },
  /** GET /api/v1/teams/{teamId}/activity */
  listTeamActivity: { method: 'get', path: '/api/v1/teams/{teamId}/activity' },
  /** GET /api/v1/teams/{teamId}/members */
  listTeamMembers: { method: 'get', path: '/api/v1/teams/{teamId}/members' },
  /** GET /api/v1/teams */
  listTeams: { method: 'get', path: '/api/v1/teams' },
  /** POST /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId}/maintenance */
  maintainHubInstallation: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/installation-launches/{launchId}/maintenance' },
  /** POST /api/v1/attestations */
  postAttestation: { method: 'post', path: '/api/v1/attestations' },
  /** POST /api/v1/teams/{teamId}/marketplace/installs */
  preparePrivateMarketplaceInstall: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/installs' },
  /** POST /api/v1/instances/{instanceId}/capability */
  publishCapability: { method: 'post', path: '/api/v1/instances/{instanceId}/capability' },
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/bundles */
  publishMarketplaceArtifactBundle: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/platforms/{platformId}/bundles' },
  /** POST /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/releases */
  publishMarketplacePlatformRelease: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/platforms/{platformId}/releases' },
  /** POST /api/v1/teams/{teamId}/marketplace/releases */
  publishMarketplaceRelease: { method: 'post', path: '/api/v1/teams/{teamId}/marketplace/releases' },
  /** PUT /api/v1/instances/{instanceId}/capability/identity */
  publishSharedIdentityCapability: { method: 'put', path: '/api/v1/instances/{instanceId}/capability/identity' },
  /** PUT /api/v1/instances/{instanceId}/plan */
  putPlan: { method: 'put', path: '/api/v1/instances/{instanceId}/plan' },
  /** PUT /api/v1/instances/{instanceId}/secrets/{name} */
  putSecret: { method: 'put', path: '/api/v1/instances/{instanceId}/secrets/{name}' },
  /** POST /api/v1/marketplace/installations/{installationId}/enrollment */
  redeemMarketplaceEnrollment: { method: 'post', path: '/api/v1/marketplace/installations/{installationId}/enrollment' },
  /** POST /api/v1/instances/{instanceId}/environments/{environment}/deployments */
  redeployHostedStarter: { method: 'post', path: '/api/v1/instances/{instanceId}/environments/{environment}/deployments' },
  /** POST /api/v1/instances/{instanceId}/redeploy */
  redeployInstance: { method: 'post', path: '/api/v1/instances/{instanceId}/redeploy' },
  /** POST /api/v1/instances/{instanceId}/plan/from-repository */
  registerPlanFromRepository: { method: 'post', path: '/api/v1/instances/{instanceId}/plan/from-repository' },
  /** POST /api/v1/instances/{instanceId}/hosting/removal */
  removeInstanceHosting: { method: 'post', path: '/api/v1/instances/{instanceId}/hosting/removal' },
  /** POST /api/v1/teams/{teamId}/starter-launch/remove */
  removeStarterLaunch: { method: 'post', path: '/api/v1/teams/{teamId}/starter-launch/remove' },
  /** DELETE /api/v1/teams/{teamId}/members/{personId} */
  removeTeamMember: { method: 'delete', path: '/api/v1/teams/{teamId}/members/{personId}' },
  /** POST /api/v1/instances/{instanceId}/artifacts */
  reportArtifact: { method: 'post', path: '/api/v1/instances/{instanceId}/artifacts' },
  /** DELETE /api/v1/instances/{instanceId}/capability/{capability}/shares/{toTeamId} */
  revokeCapabilityShare: { method: 'delete', path: '/api/v1/instances/{instanceId}/capability/{capability}/shares/{toTeamId}' },
  /** DELETE /api/v1/teams/{teamId}/invitations/{invitationId} */
  revokeInvitation: { method: 'delete', path: '/api/v1/teams/{teamId}/invitations/{invitationId}' },
  /** PUT /api/v1/teams/{teamId}/marketplace/platforms/{platformId}/maintenance */
  setMarketplaceMaintenance: { method: 'put', path: '/api/v1/teams/{teamId}/marketplace/platforms/{platformId}/maintenance' },
  /** PUT /api/v1/instances/{instanceId}/capability/{capability}/shares */
  shareCapability: { method: 'put', path: '/api/v1/instances/{instanceId}/capability/{capability}/shares' },
  /** PUT /api/v1/teams/{teamId}/marketplace/installation-launches/{launchId} */
  startHubInstallation: { method: 'put', path: '/api/v1/teams/{teamId}/marketplace/installation-launches/{launchId}' },
  /** POST /api/v1/teams/{teamId}/starter-launch */
  startStarterLaunch: { method: 'post', path: '/api/v1/teams/{teamId}/starter-launch' },
  /** POST /api/v1/instances/{instanceId}/dispatches/{dispatchId}/trigger */
  triggerDispatch: { method: 'post', path: '/api/v1/instances/{instanceId}/dispatches/{dispatchId}/trigger' },
  /** DELETE /api/v1/instances/{instanceId}/bindings/{capability} */
  unbindCapability: { method: 'delete', path: '/api/v1/instances/{instanceId}/bindings/{capability}' },
  /** POST /api/v1/teams/{teamId}/starter-launch/openbao/unlock */
  unlockStarterOpenBao: { method: 'post', path: '/api/v1/teams/{teamId}/starter-launch/openbao/unlock' },
  /** PUT /api/v1/me/profile */
  updateAccountProfile: { method: 'put', path: '/api/v1/me/profile' },
  /** PUT /api/v1/instances/{instanceId}/environments/{environment}/configuration/starter-brand */
  updateHostedStarterBrand: { method: 'put', path: '/api/v1/instances/{instanceId}/environments/{environment}/configuration/starter-brand' },
  /** PUT /api/v1/me/notification-email */
  updateMyNotificationEmail: { method: 'put', path: '/api/v1/me/notification-email' },
  /** PUT /api/v1/instances/{instanceId}/notification-rules/{ruleId} */
  updateNotificationRule: { method: 'put', path: '/api/v1/instances/{instanceId}/notification-rules/{ruleId}' },
  /** PATCH /api/v1/teams/{teamId}/members/{personId} */
  updateTeamMemberRole: { method: 'patch', path: '/api/v1/teams/{teamId}/members/{personId}' },
} as const satisfies Record<OperationId, Endpoint>;

/**
 * The `{name}` placeholders in a templated path, read out of the literal `as const` preserved.
 */
type PathPlaceholders<T extends string> = T extends `${infer _Segment}{${infer Name}}${infer Rest}`
  ? Name | PathPlaceholders<Rest>
  : never;

/** Which parameters one operation must be *given*, because its path names them. */
export type PathParamsOf<O extends OperationId> = PathPlaceholders<(typeof ENDPOINTS)[O]['path']>;

/**
 * The fillability proof, and it is the half the shape guard above cannot give.
 *
 * `satisfies Record<OperationId, Endpoint>` proves the table is complete and well-shaped. It cannot
 * prove a route is *completable*: renaming `{instanceId}` to `{id}` is a legal `string`, and the shape
 * guard stays happy while the transport refuses, at request time, a request no caller could have typed
 * -- measured on this file. So every placeholder is checked against the operation's own REQUIRED
 * parameters, once per operation, at compile time. `ROUTES_ARE_FILLABLE` is `true` today, and the pair
 * naming the offender the moment a hand edit or a partial regeneration makes it not. (`api:types:check`
 * refuses the same edit from the other side, as staleness; this is the refusal that still speaks when
 * only the compiler is run.)
 */
type RequiredParamKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];
type UnfillableRoutes = {
  [O in OperationId]: Exclude<PathParamsOf<O>, RequiredParamKeys<ParamsOf<O>>>
}[OperationId];
type RoutesAreFillable = UnfillableRoutes extends never
  ? true
  : ['a route templates a hole that operation does not declare as a required parameter', UnfillableRoutes];
export const ROUTES_ARE_FILLABLE: RoutesAreFillable = true;
