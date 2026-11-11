import { z } from 'zod';
import type { Attestation } from './attestation.ts';
import { AttestationRecordSchema, AuditEntrySchema, TeamMemberSchema, DispatchRecordSchema, InstanceSchema, ProviderConnectionSchema, RepoConnectionSchema, TeamSchema, newId,
  type AttestationRecord, type AuditEntry, type DispatchRecord, type Instance, type ProviderConnection, type RepoConnection, type Store, type StoreError, type StoreResult, type Team, type TeamMember } from './persistence.ts';
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
  private readonly plans = new Map<string, { instanceId: string; planHash: string; plan: unknown }>();
  private readonly members = new Map<string, TeamMember>();
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
    const admitted = admit(TeamSchema, { id: newId('team'), name: input.name, createdAt: this.clock() }, 'team');
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

  async createInstance(input: { teamId: string; name: string; platform: string; state?: Instance['state']; provider?: Instance['provider'] }) {
    if (this.closed) return this.refuse('createInstance');
    if (!this.teams.has(input.teamId)) return err({ code: 'not-found', what: 'team', id: input.teamId });
    const now = this.clock();
    const admitted = admit(InstanceSchema, {
      id: newId('inst'), teamId: input.teamId, name: input.name, platform: input.platform,
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

  async putTeamMember(member: Omit<TeamMember, 'addedAt'> & { addedAt?: string }) {
    if (this.closed) return this.refuse('putTeamMember');
    if (!this.teams.has(member.teamId)) return err({ code: 'not-found', what: 'team', id: member.teamId });
    const admitted = admit(TeamMemberSchema, { ...member, addedAt: member.addedAt ?? this.clock() }, 'team member');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    this.members.set(`${admitted.value.teamId}\u0000${admitted.value.subject}`, admitted.value);
    return ok(admitted.value);
  }
  async getTeamMember(teamId: string, subject: string) {
    const found = this.members.get(`${teamId}\u0000${subject}`);
    return found ? ok(copy(found)) : err({ code: 'not-found', what: 'team membership', id: `${teamId}/${subject}` });
  }
  async listTeamMembers(teamId: string) {
    return [...this.members.values()].filter((m) => m.teamId === teamId).map(copy);
  }
  async teamsForSubject(subject: string) {
    return [...this.members.values()].filter((m) => m.subject === subject).map((m) => m.teamId);
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
    this.members.clear();
    this.instances.clear();
    this.dispatches.clear();
    this.attestations.clear();
    this.auditLog.length = 0;
  }
}
