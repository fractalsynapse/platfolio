import { z } from 'zod';
import type { Attestation } from './attestation.ts';
import { AttestationRecordSchema, AuditEntrySchema, BindingRecordSchema, CapabilityOfferSchema, CapabilityShareSchema, IdentitySchema, PersonSchema, TeamMemberSchema, DispatchRecordSchema, InstanceEnvironmentStateSchema, InstanceSchema, InvitationSchema, ProviderConnectionSchema, RepoConnectionSchema, TeamSchema, newId,
  ArtifactRecordSchema,
  type ArtifactRecord, type AttestationRecord, type AuditEntry, type BindingRecord, type CapabilityOffer, type CapabilityShare, type NewBinding, type NewCapabilityOffer, type NewCapabilityShare, type DispatchRecord, type Instance, type InstanceEnvironmentState, type Invitation, type NewInvitation, type ProviderConnection, type RepoConnection, type Store, type StoreError, type NewInstance, type StoreResult, type Team, type TeamMember, type Identity, type Person } from './persistence.ts';
import { reasonOf } from './persistence.ts';
import { normaliseEmail, normaliseName } from './persistence.ts';
import { checkAttestationPolicy } from './dispatch-policy.ts';

/**
 * The in-memory implementation of `Store` -- the second implementation that makes the interface a claim
 * instead of a guess (docs/design/10 OD8), and the reason `Store` reads like the domain rather than like SQL.
 *
 * Two obligations it takes seriously because a database gets them for free and a Map does not:
 * - **copies on the way in and out**, so no caller can mutate another's view through a live reference;
 * - **refusal as a value**, not an exception, so a bad write cannot abort the controller loop that made it.
 */

const ok = <T>(value: T): StoreResult<T> => ({ ok: true, value });
const err = (e: StoreError): StoreResult<never> => ({ ok: false, ...e });
const copy = <T>(value: T): T => structuredClone(value);

/** Validate and copy in one step; a rejected write comes back as a typed refusal. */
function admit<T>(schema: z.ZodType<T>, value: unknown, label: string): { accepted: true; value: T } | { accepted: false; reason: string } {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { accepted: false, reason: `${label} is not admissible: ${parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'} ${i.message}`).join('; ')}`.slice(0, 240) };
  return { accepted: true, value: copy(parsed.data) };
}

export interface MemoryStoreOptions {
  now?: () => string;
}

export class MemoryStore implements Store {
  readonly driver = 'memory';
  private readonly teams = new Map<string, Team>();
  private readonly instances = new Map<string, Instance>();
  private readonly repos = new Map<string, RepoConnection>();
  private readonly providers = new Map<string, ProviderConnection>();
  private readonly dispatches = new Map<string, DispatchRecord>();
  private readonly invitations = new Map<string, Invitation>();
  private readonly envStates = new Map<string, InstanceEnvironmentState>();
  private readonly plans = new Map<string, { instanceId: string; planHash: string; plan: unknown }>();
  /** One current artifact per `<instanceId>/<service>` (D54) -- newest report wins. */
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private readonly persons = new Map<string, Person>();
  private readonly identities = new Map<string, Identity>();
  private readonly members = new Map<string, TeamMember>();
  private readonly offers = new Map<string, CapabilityOffer>();
  private readonly shares = new Map<string, CapabilityShare>();
  private readonly bindings = new Map<string, BindingRecord>();
  private readonly attestations = new Map<string, AttestationRecord>();
  private readonly auditLog: AuditEntry[] = [];
  private readonly clock: () => string;
  private closed = false;

  constructor(options: MemoryStoreOptions = {}) {
    this.clock = options.now ?? (() => new Date().toISOString());
  }

  private refuse(label: string): StoreResult<never> {
    if (this.closed) return err({ code: 'conflict', reason: `${label}: the store is closed` });
    return err({ code: 'conflict', reason: label });
  }

  describe() {
    return { driver: this.driver, contract: '1.0.0', schemaReady: !this.closed };
  }

  async ping(): Promise<boolean> {
    // A closed store says so. Reporting healthy after close() is how a pool pretends to work while every
    // query fails.
    return !this.closed;
  }

  async createTeam(input: { name: string }) {
    if (this.closed) return this.refuse('createTeam');
    // Uniqueness mirrored from Postgres's unique index (D45): `team/name` addresses one thing only if the
    // team half cannot collide, and a rule enforced by one driver is a rule the other will forget.
    const name = normaliseName(input.name);
    if ([...this.teams.values()].some((x) => x.name === name)) {
      return err({ code: 'conflict', reason: `a team named "${name}" already exists` });
    }
    const admitted = admit(TeamSchema, { id: newId('team'), name, createdAt: this.clock() }, 'team');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.teams.set(admitted.value.id, admitted.value);
    return ok(admitted.value);
  }
  async getTeam(id: string) {
    const found = this.teams.get(id);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'team', id });
  }
  async listTeams() {
    return [...this.teams.values()].map(copy);
  }

  async createInstance(input: NewInstance) {
    if (this.closed) return this.refuse('createInstance');
    if (!this.teams.has(input.teamId)) return err({ code: 'not-found', what: 'team', id: input.teamId });
    // Uniqueness per team, mirrored from the database's unique index (D45). If only one driver enforced it,
    // the suite would pass on one and the other would be free to drift -- which is the failure mode the
    // second implementation exists to catch, not one it should itself exhibit.
    if ([...this.instances.values()].some((i) => i.teamId === input.teamId && i.name === input.name)) {
      return err({ code: 'conflict', reason: `team ${input.teamId} already has an instance named "${input.name}"` });
    }
    const now = this.clock();
    const admitted = admit(InstanceSchema, {
      id: newId('inst'), teamId: input.teamId, name: input.name, template: input.template,
      ...(input.templateRef === undefined ? {} : { templateRef: input.templateRef }),
      state: input.state ?? 'pending', provider: input.provider ?? 'railway', createdAt: now, updatedAt: now,
    }, 'instance');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.instances.set(admitted.value.id, admitted.value);
    return ok(admitted.value);
  }
  async getInstance(id: string) {
    const found = this.instances.get(id);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'instance', id });
  }
  async listInstances(teamId?: string) {
    const all = [...this.instances.values()].map(copy);
    return teamId ? all.filter((i) => i.teamId === teamId) : all;
  }
  async updateInstanceState(id: string, state: Instance['state'], patch: { desiredPlanHash?: string; lastAppliedPlanHash?: string } = {}) {
    if (this.closed) return this.refuse('updateInstanceState');
    const found = this.instances.get(id);
    if (!found) return err({ code: 'not-found', what: 'instance', id });
    const admitted = admit(InstanceSchema, {
      ...found,
      state,
      updatedAt: this.clock(),
      ...(patch.desiredPlanHash === undefined ? {} : { desiredPlanHash: patch.desiredPlanHash }),
      ...(patch.lastAppliedPlanHash === undefined ? {} : { lastAppliedPlanHash: patch.lastAppliedPlanHash }),
    }, 'instance');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.instances.set(id, admitted.value);
    return ok(admitted.value);
  }

  async putRepoConnection(conn: RepoConnection) {
    if (this.closed) return this.refuse('putRepoConnection');
    const admitted = admit(RepoConnectionSchema, conn, 'repo connection');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    if (!this.instances.has(admitted.value.instanceId)) return err({ code: 'not-found', what: 'instance', id: admitted.value.instanceId });
    this.repos.set(admitted.value.instanceId, admitted.value);
    return ok(admitted.value);
  }
  async getRepoConnection(instanceId: string) {
    const found = this.repos.get(instanceId);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'repo connection', id: instanceId });
  }
  async putProviderConnection(conn: ProviderConnection) {
    if (this.closed) return this.refuse('putProviderConnection');
    const admitted = admit(ProviderConnectionSchema, conn, 'provider connection');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    if (!this.instances.has(admitted.value.instanceId)) return err({ code: 'not-found', what: 'instance', id: admitted.value.instanceId });
    this.providers.set(admitted.value.instanceId, admitted.value);
    return ok(admitted.value);
  }
  async getProviderConnection(instanceId: string) {
    const found = this.providers.get(instanceId);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'provider connection', id: instanceId });
  }

  async resolvePerson(input: { issuer: string; subject: string; kind?: Person['kind']; label?: string }) {
    if (this.closed) return this.refuse('resolvePerson');
    const existing = this.identities.get(`${input.issuer}\u0000${input.subject}`);
    if (existing) {
      const person = this.persons.get(existing.personId);
      if (person) return ok({ person: copy(person), created: false });
    }
    const person = admit(PersonSchema, { id: newId('person'), kind: input.kind ?? 'human', ...(input.label === undefined ? {} : { label: input.label }), createdAt: this.clock() }, 'person');
    if (!person.accepted) return err({ code: 'conflict', reason: person.reason });
    this.persons.set(person.value.id, person.value);
    const linked = await this.linkIdentity({ personId: person.value.id, issuer: input.issuer, subject: input.subject });
    if (!linked.ok) return err({ code: 'conflict', reason: `identity link refused: ${reasonOf(linked)}` });
    return ok({ person: copy(person.value), created: true });
  }
  async getPerson(id: string) {
    const found = this.persons.get(id);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'person', id });
  }
  async listPersons() {
    return [...this.persons.values()].map(copy);
  }
  async linkIdentity(input: { personId: string; issuer: string; subject: string }) {
    if (this.closed) return this.refuse('linkIdentity');
    if (!this.persons.has(input.personId)) return err({ code: 'not-found', what: 'person', id: input.personId });
    const admitted = admit(IdentitySchema, { ...input, verifiedAt: this.clock() }, 'identity');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.identities.set(`${admitted.value.issuer}\u0000${admitted.value.subject}`, admitted.value);
    return ok(admitted.value);
  }
  async unlinkIdentity(issuer: string, subject: string) {
    const existed = this.identities.delete(`${issuer}\u0000${subject}`);
    if (!existed) return err({ code: 'not-found', what: 'identity', id: `${issuer}/${subject}` });
    return ok({ removed: true });
  }
  async listIdentities(personId: string) {
    return [...this.identities.values()].filter((i) => i.personId === personId).map(copy);
  }
  async getPersonByIdentity(issuer: string, subject: string) {
    const identity = this.identities.get(`${issuer}\u0000${subject}`);
    const person = identity ? this.persons.get(identity.personId) : undefined;
    return person ? ok(copy(person)) : err({ code: 'not-found', what: 'person', id: `${issuer}/${subject}` });
  }

  async putTeamMember(member: Omit<TeamMember, 'addedAt'> & { addedAt?: string }) {
    if (this.closed) return this.refuse('putTeamMember');
    if (!this.teams.has(member.teamId)) return err({ code: 'not-found', what: 'team', id: member.teamId });
    if (!this.persons.has(member.personId)) return err({ code: 'not-found', what: 'person', id: member.personId });
    const admitted = admit(TeamMemberSchema, { ...member, addedAt: member.addedAt ?? this.clock() }, 'team member');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.members.set(`${admitted.value.teamId}\u0000${admitted.value.personId}`, admitted.value);
    return ok(admitted.value);
  }
  async getTeamMember(teamId: string, personId: string) {
    const found = this.members.get(`${teamId}\u0000${personId}`);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'team membership', id: `${teamId}/${personId}` });
  }
  async listTeamMembers(teamId: string) {
    return [...this.members.values()].filter((m) => m.teamId === teamId).map(copy);
  }
  async teamsForPerson(personId: string) {
    return [...this.members.values()].filter((m) => m.personId === personId).map((m) => m.teamId);
  }

  async publishCapability(offer: NewCapabilityOffer) {
    if (this.closed) return this.refuse('publishCapability');
    if (!this.instances.has(offer.instanceId)) return err({ code: 'not-found', what: 'instance', id: offer.instanceId });
    const admitted = admit(CapabilityOfferSchema, { ...offer, publishedAt: offer.publishedAt ?? this.clock() }, 'capability offer');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.offers.set(`${admitted.value.instanceId}\u0000${admitted.value.capability}`, admitted.value);
    return ok(admitted.value);
  }
  async getCapabilityOffer(instanceId: string, capability: string) {
    const found = this.offers.get(`${instanceId}\u0000${capability}`);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'capability offer', id: `${instanceId}/${capability}` });
  }
  async listCapabilityOffers(teamId?: string) {
    return [...this.offers.values()].filter((o) => teamId === undefined || o.teamId === teamId).map(copy);
  }

  async shareCapability(share: NewCapabilityShare) {
    if (this.closed) return this.refuse('shareCapability');
    if (!this.offers.has(`${share.instanceId}\u0000${share.capability}`)) return err({ code: 'not-found', what: 'capability offer', id: `${share.instanceId}/${share.capability}` });
    const admitted = admit(CapabilityShareSchema, { ...share, sharedAt: share.sharedAt ?? this.clock() }, 'capability share');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.shares.set(`${admitted.value.instanceId}\u0000${admitted.value.capability}\u0000${admitted.value.toTeamId}`, admitted.value);
    return ok(admitted.value);
  }
  async revokeCapabilityShare(instanceId: string, capability: string, toTeamId: string) {
    if (this.closed) return this.refuse('revokeCapabilityShare');
    const key = `${instanceId}\u0000${capability}\u0000${toTeamId}`;
    const existed = this.shares.delete(key);
    if (!existed) return err({ code: 'not-found', what: 'capability share', id: key.replace(/\u0000/g, '/') });
    // D42: the running app keeps its configuration; the *intent* is withdrawn, so bindings that depended on
    // this share go stale rather than vanishing.
    for (const [key2, binding] of this.bindings.entries()) {
      if (binding.providerInstanceId === instanceId && binding.capability === capability) {
        const consumer = this.instances.get(binding.consumerInstanceId);
        const stillShared = [...this.shares.values()].some((s) => s.instanceId === instanceId && s.capability === capability
          && (s.toTeamId === (consumer?.teamId ?? '') || s.toTeamId === '*'));
        if (!stillShared && binding.state === 'bound') {
          this.bindings.set(key2, { ...binding, state: 'stale' });
        }
      }
    }
    return ok({ revoked: true });
  }
  async listCapabilityShares(instanceId: string, capability?: string) {
    return [...this.shares.values()].filter((s) => s.instanceId === instanceId && (capability === undefined || s.capability === capability)).map(copy);
  }
  async availableOffersForTeam(teamId: string, capability?: string) {
    const own = [...this.offers.values()].filter((o) => o.teamId === teamId);
    const shared = [...this.offers.values()].filter((o) => o.teamId !== teamId
      && [...this.shares.values()].some((s) => s.instanceId === o.instanceId && s.capability === o.capability && (s.toTeamId === teamId || s.toTeamId === '*')));
    const all = [...own, ...shared].filter((o) => capability === undefined || o.capability === capability);
    return all.map(copy);
  }

  async bindCapability(binding: NewBinding) {
    if (this.closed) return this.refuse('bindCapability');
    const admitted = admit(BindingRecordSchema, { ...binding, boundAt: binding.boundAt ?? this.clock() }, 'binding');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const b = admitted.value;
    if (!this.instances.has(b.consumerInstanceId)) return err({ code: 'not-found', what: 'instance', id: b.consumerInstanceId });
    this.bindings.set(`${b.consumerInstanceId}\u0000${b.capability}`, b);
    return ok(b);
  }
  async getBinding(consumerInstanceId: string, capability: string) {
    const found = this.bindings.get(`${consumerInstanceId}\u0000${capability}`);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'binding', id: `${consumerInstanceId}/${capability}` });
  }
  async listBindings(consumerInstanceId: string) {
    return [...this.bindings.values()].filter((b) => b.consumerInstanceId === consumerInstanceId).map(copy);
  }
  async listConsumers(providerInstanceId: string, capability?: string) {
    return [...this.bindings.values()].filter((b) => b.providerInstanceId === providerInstanceId && (capability === undefined || b.capability === capability)).map(copy);
  }
  async unbindCapability(consumerInstanceId: string, capability: string) {
    if (this.closed) return this.refuse('unbindCapability');
    const key = `${consumerInstanceId}\u0000${capability}`;
    const existed = this.bindings.delete(key);
    if (!existed) return err({ code: 'not-found', what: 'binding', id: key.replace(/\u0000/g, '/') });
    return ok({ removed: true });
  }

  async createInvitation(input: NewInvitation) {
    if (this.closed) return this.refuse('createInvitation');
    if (!this.teams.has(input.teamId)) return err({ code: 'not-found', what: 'team', id: input.teamId });
    const email = normaliseEmail(input.email);
    // The same rule the partial unique index enforces in Postgres: one pending invitation per address per
    // team. Refused as a conflict rather than silently replaced, because replacing would withdraw a live
    // invitation that the invited person may already be acting on.
    if ([...this.invitations.values()].some((i) => i.teamId === input.teamId && i.email === email && i.state === 'pending')) {
      return err({ code: 'conflict', reason: `a pending invitation already exists for ${email} in this team` });
    }
    const now = this.clock();
    const ttl = input.ttlDays ?? 14;
    const admitted = admit(InvitationSchema, {
      id: newId('inv'), teamId: input.teamId, email, role: input.role, state: 'pending', invitedBy: input.invitedBy,
      createdAt: now, expiresAt: new Date(Date.parse(now) + ttl * 86_400_000).toISOString(),
    }, 'invitation');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.invitations.set(admitted.value.id, admitted.value);
    return ok(copy(admitted.value));
  }
  async getInvitation(id: string) {
    const found = this.invitations.get(id);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'invitation', id });
  }
  async listInvitations(teamId: string) {
    return [...this.invitations.values()].filter((i) => i.teamId === teamId).map((i) => copy(this.ageIfExpired(i)));
  }
  async findInvitationsForEmail(email: string) {
    const wanted = normaliseEmail(email);
    return [...this.invitations.values()].filter((i) => i.email === wanted).map((i) => copy(this.ageIfExpired(i)));
  }
  private ageIfExpired(invitation: Invitation): Invitation {
    // Expiry is observed on read rather than by a sweeper: a pending row past its date has no different
    // *meaning*, only a different truth-value for acceptance, and a background job that "fixes" it would be a
    // second answer to the same question.
    if (invitation.state === 'pending' && Date.parse(invitation.expiresAt) <= Date.parse(this.clock())) {
      const aged = { ...invitation, state: 'expired' as const };
      this.invitations.set(invitation.id, aged);
      return aged;
    }
    return invitation;
  }
  async acceptInvitation(invitationId: string, personId: string) {
    const current = this.invitations.get(invitationId);
    if (!current) return err({ code: 'not-found', what: 'invitation', id: invitationId });
    const aged = this.ageIfExpired(current);
    if (aged.state !== 'pending') return err({ code: 'conflict', reason: `invitation is ${aged.state}` });
    if (!this.persons.has(personId)) return err({ code: 'not-found', what: 'person', id: personId });
    const now = this.clock();
    const accepted: Invitation = { ...aged, state: 'accepted', acceptedBy: personId, acceptedAt: now };
    // Both writes or neither, in this order: the membership is the thing that grants, so it must not exist
    // without the recorded acceptance, and an accepted invitation granting nothing is a lie in the other
    // direction. The double has no transaction; the database does, and the shared suite asserts the outcome.
    const memberKey = `${accepted.teamId}\u0000${personId}`;
    const existing = this.members.get(memberKey);
    const member: TeamMember = existing
      ? { ...existing, role: accepted.role }
      : { teamId: accepted.teamId, personId, role: accepted.role, addedAt: now };
    this.members.set(memberKey, member);
    this.invitations.set(invitationId, accepted);
    return ok({ invitation: copy(accepted), member: copy(member) });
  }
  async revokeInvitation(id: string) {
    const found = this.invitations.get(id);
    if (!found) return err({ code: 'not-found', what: 'invitation', id });
    if (found.state === 'accepted') return err({ code: 'conflict', reason: 'an accepted invitation is a membership; remove the member instead' });
    const revoked: Invitation = { ...found, state: 'revoked', revokedAt: this.clock() };
    this.invitations.set(id, revoked);
    return ok(copy(revoked));
  }
  async setInvitationEmailResult(id: string, result: { receipt?: string; error?: string }) {
    const found = this.invitations.get(id);
    if (!found) return err({ code: 'not-found', what: 'invitation', id });
    const updated: Invitation = {
      ...found,
      ...(result.receipt === undefined ? {} : { emailReceipt: result.receipt }),
      ...(result.error === undefined ? {} : { emailError: result.error }),
    };
    this.invitations.set(id, updated);
    return ok(copy(updated));
  }

  async setInstanceEnvironment(input: { instanceId: string; environment: string; state: Instance['state']; appliedPlanHash?: string; attestationId?: string }) {
    if (this.closed) return this.refuse('setInstanceEnvironment');
    if (!this.instances.has(input.instanceId)) return err({ code: 'not-found', what: 'instance', id: input.instanceId });
    // A patch, not a replace: a writer that mentions only the state must not silently shed the hash and the
    // attestation the row already carried -- the rollup would then be computed from rows that lost their own
    // provenance, and the first version of this driver did exactly that.
    const prior = this.envStates.get(`${input.instanceId}\u0000${input.environment}`);
    // Merged into locals first. The previous version inlined `a ?? b === undefined` inside a conditional
    // spread, which parses as `a ?? (b === undefined)` -- a boolean -- so the field was dropped whenever the
    // caller *did* supply it. The suite caught it; the bug was introduced by the fix for a different bug in
    // the same three lines, which is what a gate is for.
    const appliedPlanHash = input.appliedPlanHash ?? prior?.appliedPlanHash;
    const attestationId = input.attestationId ?? prior?.attestationId;
    const admitted = admit(InstanceEnvironmentStateSchema, {
      instanceId: input.instanceId, environment: input.environment, state: input.state,
      ...(appliedPlanHash === undefined ? {} : { appliedPlanHash }),
      ...(attestationId === undefined ? {} : { attestationId }),
      updatedAt: this.clock(),
    }, 'instance environment state');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.envStates.set(`${admitted.value.instanceId}\u0000${admitted.value.environment}`, admitted.value);
    return ok(admitted.value);
  }
  async getInstanceEnvironment(instanceId: string, environment: string) {
    const found = this.envStates.get(`${instanceId}\u0000${environment}`);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'instance environment', id: `${instanceId}/${environment}` });
  }
  async listInstanceEnvironments(instanceId: string) {
    return [...this.envStates.values()].filter((e) => e.instanceId === instanceId).sort((a, b) => a.environment.localeCompare(b.environment)).map(copy);
  }

  async putPlan(instanceId: string, plan: unknown, planHash: string) {
    if (this.closed) return this.refuse('putPlan');
    if (!this.instances.has(instanceId)) return err({ code: 'not-found', what: 'instance', id: instanceId });
    if (!/^[0-9a-f]{64}$/.test(planHash)) return err({ code: 'conflict', reason: `plan hash is not a bare 64-hex digest: ${planHash.slice(0, 24)}` });
    if (!plan || typeof plan !== 'object') return err({ code: 'conflict', reason: 'plan must be an object' });
    const record = { instanceId, planHash, plan: copy(plan) };
    this.plans.set(instanceId, record);
    return ok(copy(record));
  }
  async putArtifact(artifact: Omit<ArtifactRecord, 'reportedAt'> & { reportedAt?: string }) {
    if (this.closed) return this.refuse('putArtifact');
    if (!this.instances.has(artifact.instanceId)) return err({ code: 'not-found', what: 'instance', id: artifact.instanceId });
    // Validated here as well as in the Postgres driver. Without it the double accepts a tag where the real
    // store refuses one, the shared suite passes, and the next time it runs against Postgres it fails --
    // which is the asymmetry the rule of two exists to remove.
    const checked = ArtifactRecordSchema.safeParse({ ...artifact, reportedAt: artifact.reportedAt ?? this.clock() });
    if (!checked.success) return err({ code: 'conflict', reason: `artifact is not well-formed: ${z.prettifyError(checked.error)}` });
    const record: ArtifactRecord = {
      instanceId: artifact.instanceId,
      service: artifact.service,
      image: artifact.image,
      digest: artifact.digest,
      ...(artifact.sourceRef === undefined ? {} : { sourceRef: artifact.sourceRef }),
      ...(artifact.version === undefined ? {} : { version: artifact.version }),
      reportedAt: artifact.reportedAt ?? this.clock(),
      reportedBy: artifact.reportedBy,
    };
    // Replaced, not appended: a release record answers "what is live now", and a plan derived from an old
    // digest would deploy an image the tenant believes was superseded.
    this.artifacts.set(`${record.instanceId}/${record.service}`, record);
    return ok(copy(record));
  }

  async listArtifacts(instanceId: string): Promise<ArtifactRecord[]> {
    return [...this.artifacts.values()].filter((a) => a.instanceId === instanceId).map(copy);
  }

  async getPlan(instanceId: string) {
    const found = this.plans.get(instanceId);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'plan', id: instanceId });
  }

  async createDispatch(input: Omit<DispatchRecord, 'id' | 'consumedAt'> & { id?: string }) {
    if (this.closed) return this.refuse('createDispatch');
    const admitted = admit(DispatchRecordSchema, { ...input, id: input.id ?? newId('disp'), consumedAt: null }, 'dispatch');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    if (!this.instances.has(admitted.value.instanceId)) return err({ code: 'not-found', what: 'instance', id: admitted.value.instanceId });
    if (this.dispatches.has(admitted.value.id)) return err({ code: 'conflict', reason: `dispatch ${admitted.value.id} already exists` });
    this.dispatches.set(admitted.value.id, admitted.value);
    return ok(admitted.value);
  }
  async getDispatch(id: string) {
    const found = this.dispatches.get(id);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'dispatch', id });
  }
  async consumeDispatch(id: string, at?: string) {
    if (this.closed) return this.refuse('consumeDispatch');
    const found = this.dispatches.get(id);
    if (!found) return err({ code: 'not-found', what: 'dispatch', id });
    if (found.consumedAt !== null) return err({ code: 'consumed', reason: `dispatch ${id} was consumed at ${found.consumedAt}` });
    if (Date.parse(found.expiresAt) < Date.parse(at ?? this.clock())) return err({ code: 'expired', reason: `dispatch ${id} expired at ${found.expiresAt}` });
    const next = copy({ ...found, consumedAt: at ?? this.clock() });
    this.dispatches.set(id, next);
    return ok(next);
  }
  async listDispatches(instanceId: string, limit = 50) {
    // Newest first, to match the documented interface and the Postgres driver's ORDER BY ... DESC.
    return [...this.dispatches.values()].filter((d) => d.instanceId === instanceId).slice(-limit).reverse().map(copy);
  }

  async recordAttestation(attestation: Attestation, receivedAt?: string, actor: { kind?: AttestationRecord['actorKind']; ref?: string } = {}) {
    if (this.closed) return this.refuse('recordAttestation');
    const dispatch = this.dispatches.get(attestation.dispatchId);
    const verdict = checkAttestationPolicy(attestation, dispatch ? copy(dispatch) : null);
    if (verdict.ok === false) return err(verdict.error);
    const admitted = admit(AttestationRecordSchema, {
      ...attestation,
      receivedAt: receivedAt ?? this.clock(),
      actorKind: actor.kind ?? 'shared-secret',
      ...(actor.ref === undefined ? {} : { actorRef: actor.ref }),
    }, 'attestation');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    if (this.attestations.has(admitted.value.dispatchId)) return err({ code: 'conflict', reason: `dispatch ${admitted.value.dispatchId} already attested` });
    this.attestations.set(admitted.value.dispatchId, admitted.value);
    return ok(admitted.value);
  }
  async getAttestation(dispatchId: string) {
    const found = this.attestations.get(dispatchId);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'attestation', id: dispatchId });
  }
  async latestAttestation(instanceId: string) {
    const mine = [...this.attestations.values()].filter((a) => a.instanceId === instanceId);
    if (mine.length === 0) return err({ code: 'not-found', what: 'attestation', id: instanceId });
    mine.sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt));
    return ok(copy(mine[mine.length - 1] as AttestationRecord));
  }
  async listAttestations(instanceId: string, limit = 50) {
    return [...this.attestations.values()].filter((a) => a.instanceId === instanceId).slice(-limit).reverse().map(copy);
  }

  async appendAudit(entry: Omit<AuditEntry, 'id' | 'at'> & { at?: string }) {
    if (this.closed) return this.refuse('appendAudit');
    const admitted = admit(AuditEntrySchema, { ...entry, id: newId('aud'), at: entry.at ?? this.clock() }, 'audit entry');
    // Refusal, never a throw: the controller is recording what it did, and failing to record must not abort it.
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.auditLog.push(admitted.value);
    return ok(admitted.value);
  }
  async recentAudit(limit = 50) {
    return this.auditLog.slice(-limit).reverse().map(copy);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.teams.clear();
    this.plans.clear();
    this.envStates.clear();
    this.invitations.clear();
    this.members.clear();
    this.persons.clear();
    this.identities.clear();
    this.offers.clear();
    this.shares.clear();
    this.bindings.clear();
    this.instances.clear();
    this.dispatches.clear();
    this.attestations.clear();
    this.auditLog.length = 0;
  }
}
