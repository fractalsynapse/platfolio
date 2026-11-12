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
  /**
   * Addressed `team/name`, like a repository (D45). Slug rules rather than free text: a name that needs
   * quoting, escaping, or a disambiguating id is a name that will be broken somewhere downstream -- a URL, a
   * CLI argument, a shell. Uniqueness per team is enforced by a database constraint and by the schema check
   * below, so the in-memory double cannot be the only one enforcing it.
   */
  name: z.string().min(1).max(80).regex(/^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/, 'names are lowercase slugs: a-z, 0-9 and single hyphens, no leading or trailing hyphen'),
  /**
   * The template this instance was created from. This column used to be called `platform` while storing a
   * template identifier, which is the vocabulary collision D45 removes: three different things were called
   * "platform", and one of them was a public API field.
   */
  template: z.string().min(1),
  /** Where the template came from, pinned by commit -- a tag is not a trust anchor (D30 law 3). */
  templateRef: z.object({
    repo: z.string().min(3).max(200),
    commitSha: z.string().regex(/^[0-9a-f]{40}$/, 'record the full commit, not a movable tag'),
  }).strict().optional(),
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
  /**
   * The person, not the proof. A member with two IdPs is one member; removing a proof (someone leaves SSO)
   * must not silently revoke their team access while another proof still stands.
   */
  personId: z.string().min(1),
  role: TeamRoleSchema,
  addedAt: z.string().min(1),
}).strict();
export type TeamMember = z.infer<typeof TeamMemberSchema>;

/**
 * A capability one instance offers to others (D42). Outputs are recorded as names and kinds, never values --
 * the client secret a shared Keycloak mints lives in the tenant's provider, not here (D4).
 */
export const CapabilityOfferSchema = z.object({
  instanceId: z.string().min(1),
  teamId: z.string().min(1),
  capability: z.string().min(1).max(60),
  outputs: z.array(z.object({
    output: z.string().min(1).max(80),
    kind: z.enum(['url', 'value', 'secret']),
    state: z.enum(['not-issued', 'issued-and-placed', 'placement-unknown', 're-issue-required']).default('not-issued'),
  }).strict()).default([]),
  publishedAt: z.string().min(1),
}).strict();
export type CapabilityOffer = z.infer<typeof CapabilityOfferSchema>;

/** D42: cross-team consumption requires this row. Same-team bindings do not, which is why it is optional. */
export const CapabilityShareSchema = z.object({
  instanceId: z.string().min(1),
  capability: z.string().min(1).max(60),
  /** A team identifier, or `*` for "any team" -- the wildcard is recorded, never implied. */
  toTeamId: z.string().min(1).max(120),
  sharedAt: z.string().min(1),
  sharedBy: z.string().min(1).max(200),
}).strict();
export type CapabilityShare = z.infer<typeof CapabilityShareSchema>;

/**
 * The binding record: which instance consumes which capability, from which provider instance, and into which
 * destinations. This is the thing that made "what breaks if I delete this?" unanswerable (#176) -- it existed
 * only inside rendered manifests, so platfolio could not see its own wiring.
 */
export const BindingRecordSchema = z.object({
  consumerInstanceId: z.string().min(1),
  capability: z.string().min(1).max(60),
  providerInstanceId: z.string().min(1),
  destinations: z.array(z.object({
    output: z.string().min(1).max(80),
    /** Environment entry name(s) the value is written to, as declared in the consumer's inventory. */
    into: z.array(z.string().min(1).max(120)).min(1),
  }).strict()).default([]),
  /** `stale` means the share was revoked: the app keeps running, the intent is withdrawn (D42). */
  state: z.enum(['bound', 'stale']).default('bound'),
  boundAt: z.string().min(1),
  boundBy: z.string().min(1).max(200),
}).strict();
export type BindingRecord = z.infer<typeof BindingRecordSchema>;

/**
 * Write shapes for the capability tables. Deliberately separate from the record types: a schema with defaults
 * (`state: 'bound'`, `publishedAt: now()`) still requires those fields in its *output* type, and an interface
 * that demands them forces every caller to supply values the store exists to decide.
 */
export interface NewCapabilityOffer {
  instanceId: string;
  teamId: string;
  capability: string;
  outputs?: CapabilityOffer['outputs'];
  publishedAt?: string;
}
export interface NewCapabilityShare {
  instanceId: string;
  capability: string;
  toTeamId: string;
  sharedBy: string;
  sharedAt?: string;
}
export interface NewBinding {
  consumerInstanceId: string;
  capability: string;
  providerInstanceId: string;
  destinations?: BindingRecord['destinations'];
  state?: BindingRecord['state'];
  boundBy: string;
  boundAt?: string;
}

/**
 * A person, independent of how they proved it (D44, #177).
 *
 * Membership used to hang off a bare `sub` string from the one issuer platfolio verified. That is correct
 * while there is exactly one Keycloak and wrong the moment a tenant brings an IdP: two realms can mint the
 * same `sub` for different people, and a global key cannot be both. So identity moved from "a string we
 * trust" to "a set of proofs attached to a person", and teams reference the person.
 *
 * `kind` exists because a machine client (a future `platfolio` API token) needs membership too. A second,
 * parallel authorization scheme for non-humans is how platforms end up with a back door that has different
 * rules.
 */
export const PersonSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['human', 'service']).default('human'),
  /** Display hint only -- never an authorization input, and never trusted from a client. */
  label: z.string().max(120).optional(),
  createdAt: z.string().min(1),
}).strict();
export type Person = z.infer<typeof PersonSchema>;

/** One proof: `(issuer, subject)` from a verified token, bound to a person. Unique as a pair. */
export const IdentitySchema = z.object({
  issuer: z.string().min(1),
  subject: z.string().min(1),
  personId: z.string().min(1),
  verifiedAt: z.string().min(1),
}).strict();
export type Identity = z.infer<typeof IdentitySchema>;


/**
 * One environment's state. The instance keeps a rollup field for compatibility and for "is this thing
 * working at all", but the honest answer is per environment: staging can be degraded while production is
 * live, and a single value forces one of those two lies (#179).
 */
export const InstanceEnvironmentStateSchema = z.object({
  instanceId: z.string().min(1),
  environment: z.string().min(1).max(60),
  state: InstanceStateSchema,
  appliedPlanHash: z.string().optional(),
  attestationId: z.string().optional(),
  updatedAt: z.string().min(1),
}).strict();
export type InstanceEnvironmentState = z.infer<typeof InstanceEnvironmentStateSchema>;

/**
 * Severity order for the rollup, worst last. A total order rather than a boolean, because "is it healthy"
 * has more than two answers and the rollup must be a rule, not a vibe: `degraded` outranks `live` but not
 * `failed`, and a `removed` environment is terminal rather than merely bad.
 */
const SEVERITY: InstanceState[] = ['live', 'paused', 'provisioning', 'pending', 'deprovisioning', 'degraded', 'failed', 'removed'];

/**
 * The rollup rule, stated because it is a product decision and not arithmetic.
 *
 * Production is what the tenant's customers touch, so its state is the headline; without a production row
 * yet, the worst environment wins, because an unverified staging failure is worth surfacing before anything
 * is called healthy. A row that does not exist contributes nothing -- absence is not health, hence the
 * `pending` default at the caller.
 */
export function rollupState(rows: readonly InstanceEnvironmentState[], productionEnvironment = 'production'): InstanceState {
  if (rows.length === 0) return 'pending';
  const production = rows.find((r) => r.environment === productionEnvironment);
  if (production) return production.state;
  return rows.reduce((worst, r) => (SEVERITY.indexOf(r.state) > SEVERITY.indexOf(worst) ? r.state : worst), 'live' as InstanceState);
}

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
export interface NewInstance { teamId: string; name: string; template: string; templateRef?: { repo: string; commitSha: string }; state?: InstanceState; provider?: 'railway' | 'fake' }

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

  // ---------- capability bindings (#176, D42) ----------
  /** Idempotent by instance+capability: republishing refreshes outputs rather than accumulating offers. */
  publishCapability(offer: NewCapabilityOffer): Promise<StoreResult<CapabilityOffer>>;
  getCapabilityOffer(instanceId: string, capability: string): Promise<StoreResult<CapabilityOffer>>;
  listCapabilityOffers(teamId?: string): Promise<CapabilityOffer[]>;

  /** Grants or revokes cross-team consumption. Revoking marks bound consumers `stale`; it does not delete them. */
  shareCapability(share: NewCapabilityShare): Promise<StoreResult<CapabilityShare>>;
  revokeCapabilityShare(instanceId: string, capability: string, toTeamId: string): Promise<StoreResult<{ revoked: boolean }>>;
  listCapabilityShares(instanceId: string, capability?: string): Promise<CapabilityShare[]>;
  /** Which offers this team may bind to right now -- its own, plus anything shared to it. */
  availableOffersForTeam(teamId: string, capability?: string): Promise<CapabilityOffer[]>;

  /** Validated against offers and shares by `checkBindingPolicy` before it is ever reached. */
  bindCapability(binding: NewBinding): Promise<StoreResult<BindingRecord>>;
  getBinding(consumerInstanceId: string, capability: string): Promise<StoreResult<BindingRecord>>;
  listBindings(consumerInstanceId: string): Promise<BindingRecord[]>;
  /** The deletion guard's question, answered: who consumes this provider? */
  listConsumers(providerInstanceId: string, capability?: string): Promise<BindingRecord[]>;
  unbindCapability(consumerInstanceId: string, capability: string): Promise<StoreResult<{ removed: boolean }>>;

  /**
   * Membership. `put` is idempotent by (teamId, subject): re-adding a member updates the role rather than
   * accumulating rows, because an audit of "who could see this" must have one answer.
   */
  // ---------- per-environment state (#179) ----------
  /**
   * Record one environment's state. The instance rollup is recomputed by the caller (or by the controller),
   * never derived inside the driver -- a second implementation that quietly disagrees about the rollup is
   * exactly the drift this project keeps paying to avoid.
   */
  setInstanceEnvironment(input: { instanceId: string; environment: string; state: InstanceState; appliedPlanHash?: string; attestationId?: string }): Promise<StoreResult<InstanceEnvironmentState>>;
  getInstanceEnvironment(instanceId: string, environment: string): Promise<StoreResult<InstanceEnvironmentState>>;
  listInstanceEnvironments(instanceId: string): Promise<InstanceEnvironmentState[]>;

  // ---------- persons and identities (#177, D44) ----------
  /**
   * Find or create the person behind a verified claim pair. Idempotent on `(issuer, subject)`, and called on
   * the request path by the scope guard -- which is why it takes the *verified* issuer from the claims rather
   * than trusting a caller to name one.
   */
  resolvePerson(input: { issuer: string; subject: string; kind?: Person['kind']; label?: string }): Promise<StoreResult<{ person: Person; created: boolean }>>;
  getPerson(id: string): Promise<StoreResult<Person>>;
  listPersons(): Promise<Person[]>;
  /** A person may hold several proofs; dropping one must not orphan the teams the person belongs to. */
  linkIdentity(input: { personId: string; issuer: string; subject: string }): Promise<StoreResult<Identity>>;
  unlinkIdentity(issuer: string, subject: string): Promise<StoreResult<{ removed: boolean }>>;
  listIdentities(personId: string): Promise<Identity[]>;
  getPersonByIdentity(issuer: string, subject: string): Promise<StoreResult<Person>>;

  // ---------- membership ----------
  putTeamMember(member: Omit<TeamMember, 'addedAt'> & { addedAt?: string }): Promise<StoreResult<TeamMember>>;
  getTeamMember(teamId: string, personId: string): Promise<StoreResult<TeamMember>>;
  listTeamMembers(teamId: string): Promise<TeamMember[]>;
  /**
   * The authorization question, asked once: which teams may this person act for? An empty array means
   * authenticated and belonging to nothing -- a valid state, not an error, and the reason this returns a list
   * instead of throwing.
   */
  teamsForPerson(personId: string): Promise<string[]>;

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
