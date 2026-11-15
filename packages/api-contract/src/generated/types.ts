/**
 * GENERATED FILE -- DO NOT EDIT. The writer is `scripts/gen-api-types.ts` (the emitter lives in
 * packages/api-contract/src/generate-types.ts) and it is the only one: nothing here is worth editing by
 * hand, because every line reproduces from the specification.
 *
 * Source: apps/control-plane/openapi.yaml (OpenAPI 3.1.0, info.version 0.1.0)
 * Input digest: sha256/e9a3b77dac4c177d
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

export interface Attestation {
  dispatchId: string;
  instanceId: string;
  nonce: string;
  planHash: string;
  action: 'apply' | 'destroy';
  environment: string;
  result: 'ok' | 'partial' | 'failed' | 'noop';
  resources: Array<{
    kind: string;
    name: string;
    externalId?: string;
    status: string;
  }>;
  errorCode?: string;
  release: {
    version: string;
    commitSha: string;
    imageDigest: string;
  };
  durationMs: number;
  finishedAt: string;
}

export interface AttestationRecord {
  dispatchId: string;
  instanceId: string;
  nonce: string;
  planHash: string;
  action: 'apply' | 'destroy';
  environment: string;
  result: 'ok' | 'partial' | 'failed' | 'noop';
  resources: Array<{
    kind: string;
    name: string;
    externalId?: string;
    status: string;
  }>;
  errorCode?: string;
  release: {
    version: string;
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

export interface DispatchIntent {
  instanceId: string;
  teamId: string;
  dispatchId: string;
  nonce: string;
  planHash: string;
  action: 'apply' | 'destroy';
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
  /** The rollup, not the truth: production's state when a production environment exists, otherwise the worst among the environments (#179). `environments` below is what actually happened per place. */
  state: 'pending' | 'provisioning' | 'live' | 'degraded' | 'paused' | 'failed' | 'deprovisioning' | 'removed';
  /** One row per environment the instance has. Absent until the first reconcile. */
  environments?: Array<{
    instanceId: string;
    environment: string;
    state: 'pending' | 'provisioning' | 'live' | 'degraded' | 'paused' | 'failed' | 'deprovisioning' | 'removed';
    appliedPlanHash?: string;
    attestationId?: string;
    updatedAt: string;
  }>;
  provider: 'railway' | 'fake';
  desiredPlanHash?: string;
  lastAppliedPlanHash?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invitation {
  id: string;
  teamId: string;
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
  /** The transport's receipt */
  emailReceipt?: string;
  emailError?: string;
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

export interface TeamWithRole {
  teamId: string;
  name: Slug;
  role: 'owner' | 'member';
}

export interface Version {
  name: 'control-plane';
  version: string;
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
  /** PUT /api/v1/instances/{instanceId}/bindings/{capability} */
  bindCapability: {
    instanceId: string;
    capability: string;
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
  /** POST /api/v1/teams */
  createTeam: Record<string, never>;
  /** DELETE /api/v1/instances/{instanceId} */
  destroyInstance: {
    instanceId: string;
  };
  /** GET /api/v1/me */
  getCurrentPerson: Record<string, never>;
  /** GET /api/v1/instances/{instanceId}/dispatches/{dispatchId} */
  getDispatchPlan: {
    instanceId: string;
    dispatchId: string;
  };
  /** GET /healthz */
  getHealth: Record<string, never>;
  /** GET /api/v1/instances/{instanceId} */
  getInstance: {
    instanceId: string;
  };
  /** GET /api/v1/instances/{instanceId}/latest-attestation */
  getLatestAttestation: {
    instanceId: string;
  };
  /** GET /readyz */
  getReady: Record<string, never>;
  /** GET /version */
  getVersion: Record<string, never>;
  /** GET /api/v1/whoami */
  getWhoami: Record<string, never>;
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
  /** GET /api/v1/instances */
  listInstances: Record<string, never>;
  /** GET /api/v1/teams/{teamId}/invitations */
  listInvitations: {
    teamId: string;
  };
  /** GET /api/v1/me/invitations */
  listMyInvitations: Record<string, never>;
  /** GET /api/v1/instances/{instanceId}/secrets */
  listSecretPresence: {
    instanceId: string;
    environment: string;
    service: string;
  };
  /** GET /api/v1/teams */
  listTeams: Record<string, never>;
  /** POST /api/v1/attestations */
  postAttestation: Record<string, never>;
  /** POST /api/v1/instances/{instanceId}/capability */
  publishCapability: {
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
  /** POST /api/v1/instances/{instanceId}/plan/from-repository */
  registerPlanFromRepository: {
    instanceId: string;
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
  /** PUT /api/v1/instances/{instanceId}/capability/{capability}/shares */
  shareCapability: {
    instanceId: string;
    capability: string;
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
  /** PUT /api/v1/instances/{instanceId}/bindings/{capability} */
  bindCapability: {
    providerInstanceId: string;
    destinations: Array<{
      output: string;
      into: string[];
    }>;
  };
  /** POST /api/v1/instances/{instanceId}/dispatches */
  createDispatch: {
    action?: 'apply' | 'destroy';
    environment?: string;
  };
  /** POST /api/v1/instances */
  createInstance: {
    teamId: string;
    name: string;
    /** Catalog identifier */
    template: string;
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
  /** POST /api/v1/teams */
  createTeam: {
    name: Slug;
  };
  /** POST /api/v1/attestations */
  postAttestation: Attestation;
  /** POST /api/v1/instances/{instanceId}/capability */
  publishCapability: {
    capability: string;
    outputs?: Array<{
      output: string;
      kind: 'url' | 'value' | 'secret';
      state?: 'not-issued' | 'issued-and-placed' | 'placement-unknown' | 're-issue-required';
    }>;
  };
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
  };
  /** POST /api/v1/instances/{instanceId}/plan/from-repository */
  registerPlanFromRepository: {
    /** Manifest location within the repository. Default `compose.yaml`. */
    path?: string;
    /** The pinned production overlay. Default `compose.prod.yaml`. Absent is allowed only when every service in `path` already carries a digest; otherwise the refusal says which service is unpinned. */
    overlayPath?: string;
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
  /** PUT /api/v1/instances/{instanceId}/capability/{capability}/shares */
  shareCapability: {
    /** A team id, or `*` to offer it to every team. Recorded, never implied. */
    toTeamId: string;
  };
  /** POST /api/v1/instances/{instanceId}/dispatches/{dispatchId}/trigger */
  triggerDispatch: {
    /** Branch or tag GitHub should run on. Not the plan's commit: a workflow run belongs to a branch, and the digest it must satisfy travels as an input. */
    ref: string;
    /** Workflow file name. Default `platfolio-managed.yml`. */
    workflow?: string;
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
  /** PUT /api/v1/instances/{instanceId}/bindings/{capability} */
  bindCapability: {
    '200': BindingRecord;
    '400': Error;
    '401': Error;
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
  /** POST /api/v1/teams */
  createTeam: {
    '201': TeamWithRole;
    '400': Error;
    '401': Error;
    '409': Error;
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
  /** GET /healthz */
  getHealth: {
    '200': Health;
  };
  /** GET /api/v1/instances/{instanceId} */
  getInstance: {
    '200': Instance;
    '401': Error;
    '404': Error;
  };
  /** GET /api/v1/instances/{instanceId}/latest-attestation */
  getLatestAttestation: {
    '200': AttestationRecord;
    '401': Error;
    '404': Error;
  };
  /** GET /readyz */
  getReady: {
    '200': Ready;
    '503': Ready;
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
  /** GET /api/v1/instances */
  listInstances: {
    '200': Instance[];
    '401': Error;
  };
  /** GET /api/v1/teams/{teamId}/invitations */
  listInvitations: {
    '200': Invitation[];
    '401': Error;
    '403': Error;
    '404': Error;
  };
  /** GET /api/v1/me/invitations */
  listMyInvitations: {
    '200': Invitation[];
    '401': Error;
    '409': Error;
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
  /** GET /api/v1/teams */
  listTeams: {
    '200': Array<{
      teamId: string;
      name: Slug;
      role: 'owner' | 'member';
    }>;
    '401': Error;
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
  /** POST /api/v1/instances/{instanceId}/capability */
  publishCapability: {
    '200': CapabilityOffer;
    '400': Error;
    '401': Error;
    '404': Error;
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
  /** PUT /api/v1/instances/{instanceId}/capability/{capability}/shares */
  shareCapability: {
    '200': CapabilityShare;
    '400': Error;
    '401': Error;
    '403': Error;
    '404': Error;
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
