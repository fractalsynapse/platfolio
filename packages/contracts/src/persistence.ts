import { z } from 'zod';
import { AttestationSchema, type Attestation } from './attestation.ts';

/**
 * The control plane's records (`Store`), as a capability rather than a table layout (D15: the kernel is the
 * only place that may know a driver; the app must not know SQL).
 *
 * The shape of this interface is tested by an in-memory double that passes the same conformance suite as the
 * Postgres implementation -- the rule of two (docs/design/10 § the seams). If the interface were accidentally
 * SQL-shaped it would read like transactions and row ids; it reads like the domain, because the double has to
 * satisfy it too.
 *
 * Two invariants are enforced by the schemas, not by discipline:
 *
 * - **No secret values, ever** (D4). A provider connection carries a tier and secret *names*; there is no
 *   field a credential could be put into, so "did we remember to redact" stops being a question.
 * - **Nothing timestamped or identified by callers.** Ids and `createdAt` are assigned by the store, so a
 *   client cannot forge its own audit trail.
 */

export const STORE_CONTRACT = 'control-plane.store';
export const STORE_CONTRACT_VERSION = '1.0.0';

/** Names only. A `value` field is deliberately absent: adding one is a contract change, not a slip. */
export const SecretNameSchema = z.object({
  name: z.string().min(1).max(120).regex(/^[A-Z][A-Z0-9_]*$/, 'secret names are upper snake case, as GitHub requires'),
  source: z.enum(['preserve', 'tenant-set', 'generated']).default('preserve'),
  set: z.boolean().default(false),
}).strict();
export type SecretName = z.infer<typeof SecretNameSchema>;

export const TeamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  createdAt: z.string().min(1),
}).strict();
export type Team = z.infer<typeof TeamSchema>;

export const InstanceStateSchema = z.enum(['pending', 'provisioning', 'live', 'degraded', 'paused', 'failed', 'deprovisioning', 'removed']);
export type InstanceState = z.infer<typeof InstanceStateSchema>;

export const InstanceSchema = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  name: z.string().min(1).max(80),
  platform: z.string().min(1),
  state: InstanceStateSchema,
  /** The provider is a swappable capability (D1); the instance records which one it is on. */
  provider: z.enum(['railway', 'fake']).default('railway'),
  desiredPlanHash: z.string().optional(),
  lastAppliedPlanHash: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict();
export type Instance = z.infer<typeof InstanceSchema>;

/** Repository facts. `actionRef` is the pinned commit -- the trust anchor is a SHA, never a tag (D30 law 3). */
export const RepoConnectionSchema = z.object({
  instanceId: z.string().min(1),
  repo: z.string().min(3).max(200),
  defaultBranch: z.string().min(1).max(100),
  actionRef: z.string().regex(/^[0-9a-f]{40}$/, 'the managed action is pinned by full commit SHA'),
  installedAt: z.string().min(1),
}).strict();
export type RepoConnection = z.infer<typeof RepoConnectionSchema>;

/**
 * Where the provider credential lives, recorded as a tier (D24). `externalId` is a public identifier, not a
 * secret; there is no place to store a token, and the presence check is the only thing we keep about secrets.
 */
export const ProviderConnectionSchema = z.object({
  instanceId: z.string().min(1),
  tier: z.enum(['managed', 'self-custody']),
  workspaceHint: z.string().max(120).optional(),
  projectExternalId: z.string().max(120).optional(),
  secrets: z.array(SecretNameSchema).default([]),
  connectedAt: z.string().min(1),
}).strict();
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;

export const DispatchRecordSchema = z.object({
  id: z.string().min(1),
  instanceId: z.string().min(1),
  nonce: z.string().min(16).max(64),
  planHash: z.string().min(16),
  action: z.enum(['apply', 'destroy']),
  environment: z.string().min(1).max(60),
  issuedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  /** Single use. `null` until a runner fetches it; a second fetch is a replay, not a retry. */
  consumedAt: z.string().nullable().default(null),
  plan: z.unknown(),
}).strict();
export type DispatchRecord = z.infer<typeof DispatchRecordSchema>;

export const AttestationRecordSchema = AttestationSchema.extend({
  receivedAt: z.string().min(1),
  /**
   * The *verified* identity of whoever posted, recorded as claims rather than a token. When #159 lands this
   * becomes meaningful; today a shared secret authenticates, so `actorSubject` is written as 'shared-secret'
   * rather than implying a repository binding we did not check.
   */
  actorKind: z.enum(['runner', 'operator', 'shared-secret']).default('shared-secret'),
  actorRef: z.string().max(200).optional(),
}).strict();
export type AttestationRecord = z.infer<typeof AttestationRecordSchema>;

export const AuditEntrySchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  actorKind: z.enum(['user', 'runner', 'controller', 'system']),
  actorRef: z.string().max(200),
  action: z.string().min(1).max(120),
  target: z.string().min(1).max(200),
  /** Structured, bounded, and never a credential: reason codes and ids, not payloads. */
  detail: z.record(z.string(), z.union([z.string().max(300), z.number(), z.boolean()])).default({}),
}).strict();
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/**
 * Who belongs to which team, and in what role.
 *
 * This exists because verified authentication is not authorization: the control plane could already prove a
 * token was genuine and signed by the right issuer, and still answer `GET /api/v1/instances` with every
 * team's rows (#173). `subject` is the IdP's stable user id -- the token's `sub` -- because that is the only
 * identity claim this platform is willing to trust, and a second mapping from username or email would be a
 * second source of who someone is.
 */
export const TeamRoleSchema = z.enum(['owner', 'member']);
export type TeamRole = z.infer<typeof TeamRoleSchema>;

export const TeamMemberSchema = z.object({
  teamId: z.string().min(1),
  subject: z.string().min(1).max(200),
  role: TeamRoleSchema,
  addedAt: z.string().min(1),
}).strict();
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export type StoreError =
  | { code: 'not-found'; what: string; id: string }
  | { code: 'conflict'; reason: string }
  | { code: 'expired'; reason: string }
  | { code: 'consumed'; reason: string };

/** Result union rather than exceptions, because the HTTP layer maps these to status codes by case. */
export type StoreResult<T> = { ok: true; value: T } | ({ ok: false } & StoreError);

/**
 * Why something was refused, as one line, for every variant. Both the HTTP layer and the audit trail need this,
 * and neither should hand-match the union: `not-found` carries what/id while the others carry a reason, so a
 * call site that guesses produces an empty message -- which reads as "no problem" exactly when there is one.
 */
export function reasonOf(error: StoreError): string {
  switch (error.code) {
    case 'not-found': return `${error.what} ${error.id} not found`;
    case 'conflict': return error.reason;
    case 'expired': return error.reason;
    case 'consumed': return error.reason;
  }
}

export interface NewTeam { name: string }
export interface NewInstance { teamId: string; name: string; platform: string; state?: InstanceState; provider?: 'railway' | 'fake' }

/**
 * The capability. Deliberately free of `query`, `transaction`, `pool` and `row` -- a second implementation
 * (memory today, another database or an embedded store later) must be able to satisfy it without being the
 * first implementation wearing a different name.
 */
export interface Store {
  readonly driver: string;
  describe(): { driver: string; contract: string; schemaReady: boolean };
  ping(): Promise<boolean>;

  createTeam(input: NewTeam): Promise<StoreResult<Team>>;
  getTeam(id: string): Promise<StoreResult<Team>>;
  /** Oldest first: teams are a small, stable listing, not a feed. */
  listTeams(): Promise<Team[]>;

  createInstance(input: NewInstance): Promise<StoreResult<Instance>>;
  getInstance(id: string): Promise<StoreResult<Instance>>;
  /** Oldest first, so a tenant's platforms keep the order they were created in. */
  listInstances(teamId?: string): Promise<Instance[]>;
  updateInstanceState(id: string, state: InstanceState, patch?: { desiredPlanHash?: string; lastAppliedPlanHash?: string }): Promise<StoreResult<Instance>>;

  /** Idempotent by instance: reconnecting a repository replaces the record, it does not accumulate history. */
  putRepoConnection(conn: RepoConnection): Promise<StoreResult<RepoConnection>>;
  getRepoConnection(instanceId: string): Promise<StoreResult<RepoConnection>>;
  putProviderConnection(conn: ProviderConnection): Promise<StoreResult<ProviderConnection>>;
  getProviderConnection(instanceId: string): Promise<StoreResult<ProviderConnection>>;

  /**
   * The desired state a dispatch authorises. Stored beside the instance, and *copied into* the dispatch when
   * one is issued: a runner must get the plan that was current at issue time, not whatever changed while its
   * workflow sat in a queue.
   */
  putPlan(instanceId: string, plan: unknown, planHash: string): Promise<StoreResult<{ instanceId: string; planHash: string }>>;
  getPlan(instanceId: string): Promise<StoreResult<{ instanceId: string; planHash: string; plan: unknown }>>;

  /**
   * Membership. `put` is idempotent by (teamId, subject): re-adding a member updates the role rather than
   * accumulating rows, because an audit of "who could see this" must have one answer.
   */
  putTeamMember(member: Omit<TeamMember, 'addedAt'> & { addedAt?: string }): Promise<StoreResult<TeamMember>>;
  getTeamMember(teamId: string, subject: string): Promise<StoreResult<TeamMember>>;
  listTeamMembers(teamId: string): Promise<TeamMember[]>;
  /**
   * The authorization question, asked once: which teams may this subject act for? An empty array means the
   * caller is authenticated and belongs to nothing -- which is a valid state, not an error, and the reason
   * this returns a list instead of throwing.
   */
  teamsForSubject(subject: string): Promise<string[]>;

  createDispatch(input: Omit<DispatchRecord, 'id' | 'consumedAt'> & { id?: string }): Promise<StoreResult<DispatchRecord>>;
  getDispatch(id: string): Promise<StoreResult<DispatchRecord>>;
  /** The single-use gate, in the store rather than the handler, so no code path can forget it. */
  consumeDispatch(id: string, at?: string): Promise<StoreResult<DispatchRecord>>;
  /** Newest first (see `recentAudit`). */
  listDispatches(instanceId: string, limit?: number): Promise<DispatchRecord[]>;

  /** Rejected here if the dispatch is unknown, consumed, expired, or the hash moved (policy in `checkAttestation`). */
  recordAttestation(attestation: Attestation, receivedAt?: string, actor?: { kind?: AttestationRecord['actorKind']; ref?: string }): Promise<StoreResult<AttestationRecord>>;
  getAttestation(dispatchId: string): Promise<StoreResult<AttestationRecord>>;
  latestAttestation(instanceId: string): Promise<StoreResult<AttestationRecord>>;
  /** Newest first (see `recentAudit`). */
  listAttestations(instanceId: string, limit?: number): Promise<AttestationRecord[]>;

  /** StoreResult, not a bare entry: an audit write that throws would abort the controller loop it is trying
   *  to record, so a failed record must be a value the caller can decide about. */
  appendAudit(entry: Omit<AuditEntry, 'id' | 'at'> & { at?: string }): Promise<StoreResult<AuditEntry>>;
  /**
   * Newest first, always -- and ties are broken by insertion order rather than left to chance. Both halves were
   * learned the hard way: the double returned insertion order where Postgres sorted by `at` (the suite caught
   * that by asserting a position), and then CI caught the other half, where three rows shared one statement
   * timestamp and `ORDER BY at DESC` between them was a coin flip. A contract that says "recent" has to say
   * what happens when two things are equally recent.
   */
  recentAudit(limit?: number): Promise<AuditEntry[]>;

  close(): Promise<void>;
}

/** Collision-resistant ids assigned by the store, never by the caller. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(9);
  // Node 22 ships WebCrypto globally; reaching for `node:crypto` via require() inside an ESM module would
  // resolve only by accident, so the standard API is used instead.
  crypto.getRandomValues(bytes);
  return `${prefix}-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
