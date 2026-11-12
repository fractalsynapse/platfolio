import { Pool } from 'pg';
import {
  AttestationRecordSchema, AuditEntrySchema, BindingRecordSchema, CapabilityOfferSchema, CapabilityShareSchema, DispatchRecordSchema, IdentitySchema, PersonSchema, TeamMemberSchema, InstanceEnvironmentStateSchema, InstanceSchema, InvitationSchema, ProviderConnectionSchema, RepoConnectionSchema, TeamSchema, newId,
  type AttestationRecord, type AuditEntry, type BindingRecord, type CapabilityOffer, type NewBinding, type NewCapabilityOffer, type NewCapabilityShare, type DispatchRecord, type Instance, type InstanceEnvironmentState, type Invitation, type NewInvitation, type ProviderConnection, type RepoConnection, type Store, type StoreError, type NewInstance, type StoreResult, type Team, type Person, type TeamMember,
} from './persistence.ts';
import { reasonOf } from './persistence.ts';
import { normaliseEmail } from './persistence.ts';
import { checkAttestationPolicy } from './dispatch-policy.ts';
import type { Attestation } from './attestation.ts';

/**
 * The Postgres implementation of `Store`. This is the case that decides whether the `Store` interface is real:
 * it runs the same conformance suite as the memory double, and where the database is *stronger* -- a conditional
 * `UPDATE ... WHERE consumed_at IS NULL` makes dispatch single-use atomic across processes, which the double
 * can only approximate -- the suite still passes because the interface asks for the behaviour, not the
 * mechanism (docs/design/10 § the seams).
 *
 * Column layout is this file's business. Nothing above it sees SQL.
 */
export interface PostgresStoreOptions {
  connectionString?: string;
  /**
   * Pool sizing as plain data, deliberately NOT `pg`'s PoolConfig: a driver's type appearing in this
   * interface would put the dependency in the public surface of the capability, so every consumer would need
   * the driver's typings to compile -- which is the seam leaking.
   */
  pool?: { maxConnections?: number; idleTimeoutMs?: number };
  /** Default `platfolio`; kept configurable so a tenant's own database can host it without renaming tables. */
  schema?: string;
  expectedMigrations?: number[];
  statementTimeoutMs?: number;
}

const ok = <T>(value: T): StoreResult<T> => ({ ok: true, value });
const err = (e: StoreError): StoreResult<never> => ({ ok: false, ...e });
/** Unwrap the rows that parsed. A malformed row is dropped rather than thrown: one bad record must not make
 *  an entire list endpoint fail, and a list of nothing is a signal in itself. */
function values<T>(results: StoreResult<T>[]): T[] {
  return results.flatMap((r) => (r.ok ? [r.value] : []));
}


/**
 * Timestamps as RFC 3339. node-postgres hands back `Date` objects and `String(date)` is
 * "Wed Nov 11 2026 12:00:00 GMT+0000" -- not a date-time, so every response carrying one was refused by the
 * OpenAPI gate as `response-violates-spec`. The gate caught a serialization bug the fake-store tests could not
 * see, because the double never returns a Date.
 */
const iso = (value: unknown): string => (value instanceof Date ? value : new Date(String(value))).toISOString();

function admit<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: { path: (string | number | symbol)[]; message: string }[] } } }, value: unknown, label: string): { accepted: true; value: T } | { accepted: false; reason: string } {
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) {
    const issues = parsed.error?.issues ?? [];
    return { accepted: false, reason: `${label} is not admissible: ${issues.map((i) => `${(i.path ?? []).join('.') || '<root>'} ${i.message}`).join('; ')}`.slice(0, 240) };
  }
  return { accepted: true, value: parsed.data };
}

interface Row { [column: string]: unknown }

export class PostgresStore implements Store {
  readonly driver = 'postgres';
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly expectedMigrations: number[];
  private closed = false;

  constructor(options: PostgresStoreOptions = {}) {
    this.schema = /^[a-z_][a-z0-9_]*$/.test(options.schema ?? 'platfolio') ? (options.schema ?? 'platfolio') : 'platfolio';
    this.expectedMigrations = options.expectedMigrations ?? [1];
    const user = options.pool ?? {};
    this.pool = new Pool({
      max: user.maxConnections ?? 10,
      idleTimeoutMillis: user.idleTimeoutMs ?? 30_000,
      ...(options.connectionString ? { connectionString: options.connectionString } : {}),
    });
  }

  private q(table: string): string {
    return `${this.schema}.${table}`;
  }

  describe() {
    return { driver: this.driver, contract: '1.0.0', schemaReady: this.ready };
  }

  private ready = false;

  async ping(): Promise<boolean> {
    if (this.closed) return false;
    try {
      const result = await this.pool.query('SELECT 1 AS one');
      this.ready = result.rows[0]?.one === 1 && await this.migrationsCurrent();
      return this.ready;
    } catch {
      this.ready = false;
      return false;
    }
  }

  /**
   * Readiness is the migrations ledger, not "a query worked". Half-migrated schemas answer SELECT 1 and then
   * fail on the first INSERT, which is the worst possible time to discover it.
   */
  private async migrationsCurrent(): Promise<boolean> {
    try {
      const result = await this.pool.query(`SELECT version FROM ${this.q('schema_migrations')} ORDER BY version ASC`);
      const seen = result.rows.map((r) => Number(r.version));
      return this.expectedMigrations.every((v) => seen.includes(v));
    } catch {
      return false;
    }
  }

  async createTeam(input: { name: string }) {
    const admitted = admit(TeamSchema, { id: newId('team'), name: input.name, createdAt: new Date().toISOString() }, 'team');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const t = admitted.value;
    await this.pool.query(`INSERT INTO ${this.q('teams')} (id, name, created_at) VALUES ($1, $2, $3)`, [t.id, t.name, t.createdAt]);
    return ok(t);
  }

  async getTeam(id: string) {
    const rows = (await this.pool.query(`SELECT id, name, created_at FROM ${this.q('teams')} WHERE id = $1`, [id])).rows as Row[];
    const row = rows[0];
    return row ? this.asTeam(row) : err({ code: 'not-found', what: 'team', id });
  }

  async listTeams() {
    const rows = (await this.pool.query(`SELECT id, name, created_at FROM ${this.q('teams')} ORDER BY created_at ASC`)).rows as Row[];
    return values(rows.map((r) => this.asTeam(r)));
  }

  private asTeam(row: Row): StoreResult<Team> {
    const admitted = admit(TeamSchema, { id: row.id, name: row.name, createdAt: iso(row.created_at) }, 'team row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async createInstance(input: NewInstance) {
    const now = new Date().toISOString();
    const admitted = admit(InstanceSchema, {
      id: newId('inst'), teamId: input.teamId, name: input.name, template: input.template,
      ...(input.templateRef === undefined ? {} : { templateRef: input.templateRef }),
      state: input.state ?? 'pending', provider: input.provider ?? 'railway', createdAt: now, updatedAt: now,
    }, 'instance');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const i = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('instances')} (id, team_id, name, template, template_repo, template_commit, state, provider, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [i.id, i.teamId, i.name, i.template, i.templateRef?.repo ?? null, i.templateRef?.commitSha ?? null, i.state, i.provider, i.createdAt, i.updatedAt]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      // A foreign-key violation is the referential guard the suite asserts; report it as a typed refusal.
      if (code === '23503') return err({ code: 'not-found', what: 'team', id: input.teamId });
      // The unique index on (team_id, name) is D45's rule, and it must surface as the same typed conflict the
      // double raises -- otherwise the two drivers answer the same collision differently, and only one of
      // them is what production runs.
      if (code === '23505') return err({ code: 'conflict', reason: `team ${input.teamId} already has an instance named "${input.name}"` });
      throw error;
    }
    return ok(i);
  }

  async getInstance(id: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('instances')} WHERE id = $1`, [id])).rows as Row[];
    const row = rows[0];
    return row ? this.asInstance(row) : err({ code: 'not-found', what: 'instance', id });
  }

  async listInstances(teamId?: string) {
    const sql = teamId ? `SELECT * FROM ${this.q('instances')} WHERE team_id = $1 ORDER BY created_at ASC` : `SELECT * FROM ${this.q('instances')} ORDER BY created_at ASC`;
    const rows = (await this.pool.query(sql, teamId ? [teamId] : [])).rows as Row[];
    return values(rows.map((r) => this.asInstance(r)));
  }

  private asInstance(row: Row): StoreResult<Instance> {
    const admitted = admit(InstanceSchema, {
      id: row.id, teamId: row.team_id, name: row.name, template: row.template,
      ...(row.template_repo === null || row.template_commit === null ? {} : { templateRef: { repo: String(row.template_repo), commitSha: String(row.template_commit) } }),
      state: row.state, provider: row.provider,
      ...(row.desired_plan_hash === null ? {} : { desiredPlanHash: String(row.desired_plan_hash) }),
      ...(row.last_applied_plan_hash === null ? {} : { lastAppliedPlanHash: String(row.last_applied_plan_hash) }),
      createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    }, 'instance row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async updateInstanceState(id: string, state: Instance['state'], patch: { desiredPlanHash?: string; lastAppliedPlanHash?: string } = {}) {
    const rows = (await this.pool.query(
      `UPDATE ${this.q('instances')}
         SET state = $2, updated_at = now(),
             desired_plan_hash = COALESCE($3, desired_plan_hash),
             last_applied_plan_hash = COALESCE($4, last_applied_plan_hash)
       WHERE id = $1 RETURNING *`,
      [id, state, patch.desiredPlanHash ?? null, patch.lastAppliedPlanHash ?? null])).rows as Row[];
    const row = rows[0];
    return row ? this.asInstance(row) : err({ code: 'not-found', what: 'instance', id });
  }

  async putRepoConnection(conn: RepoConnection) {
    const admitted = admit(RepoConnectionSchema, conn, 'repo connection');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const c = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('repo_connections')} (instance_id, repo, default_branch, action_ref, installed_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (instance_id) DO UPDATE SET repo = EXCLUDED.repo, default_branch = EXCLUDED.default_branch,
                                                action_ref = EXCLUDED.action_ref, installed_at = EXCLUDED.installed_at`,
        [c.instanceId, c.repo, c.defaultBranch, c.actionRef, c.installedAt]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'instance', id: c.instanceId });
      throw error;
    }
    return ok(c);
  }

  async getRepoConnection(instanceId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('repo_connections')} WHERE instance_id = $1`, [instanceId])).rows as Row[];
    const row = rows[0];
    if (!row) return err({ code: 'not-found', what: 'repo connection', id: instanceId });
    const admitted = admit(RepoConnectionSchema, { instanceId: row.instance_id, repo: row.repo, defaultBranch: row.default_branch, actionRef: String(row.action_ref).trim(), installedAt: iso(row.installed_at) }, 'repo connection row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async putProviderConnection(conn: ProviderConnection) {
    const admitted = admit(ProviderConnectionSchema, conn, 'provider connection');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const c = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('provider_connections')} (instance_id, tier, workspace_hint, project_external_id, secrets, connected_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT (instance_id) DO UPDATE SET tier = EXCLUDED.tier, workspace_hint = EXCLUDED.workspace_hint,
                                                 project_external_id = EXCLUDED.project_external_id,
                                                 secrets = EXCLUDED.secrets, connected_at = EXCLUDED.connected_at`,
        [c.instanceId, c.tier, c.workspaceHint ?? null, c.projectExternalId ?? null, JSON.stringify(c.secrets), c.connectedAt]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'instance', id: c.instanceId });
      throw error;
    }
    return ok(c);
  }

  async getProviderConnection(instanceId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('provider_connections')} WHERE instance_id = $1`, [instanceId])).rows as Row[];
    const row = rows[0];
    if (!row) return err({ code: 'not-found', what: 'provider connection', id: instanceId });
    const admitted = admit(ProviderConnectionSchema, {
      instanceId: row.instance_id, tier: row.tier,
      ...(row.workspace_hint === null ? {} : { workspaceHint: String(row.workspace_hint) }),
      ...(row.project_external_id === null ? {} : { projectExternalId: String(row.project_external_id) }),
      secrets: row.secrets, connectedAt: iso(row.connected_at),
    }, 'provider connection row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async publishCapability(offer: NewCapabilityOffer) {
    const admitted = admit(CapabilityOfferSchema, { ...offer, publishedAt: offer.publishedAt ?? new Date().toISOString() }, 'capability offer');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const o = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('capability_offers')} (instance_id, capability, team_id, outputs, published_at)
         VALUES ($1,$2,$3,$4::jsonb,$5)
         ON CONFLICT (instance_id, capability) DO UPDATE SET outputs = EXCLUDED.outputs, published_at = now()`,
        [o.instanceId, o.capability, o.teamId, JSON.stringify(o.outputs), o.publishedAt]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'instance', id: o.instanceId });
      throw error;
    }
    return ok(o);
  }

  async getCapabilityOffer(instanceId: string, capability: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('capability_offers')} WHERE instance_id = $1 AND capability = $2`, [instanceId, capability])).rows as Row[];
    const row = rows[0];
    return row ? this.asOffer(row) : err({ code: 'not-found', what: 'capability offer', id: `${instanceId}/${capability}` });
  }

  private asOffer(row: Row): StoreResult<CapabilityOffer> {
    const admitted = admit(CapabilityOfferSchema, { instanceId: row.instance_id, capability: row.capability, teamId: row.team_id, outputs: row.outputs, publishedAt: iso(row.published_at) }, 'capability offer row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async listCapabilityOffers(teamId?: string) {
    const sql = teamId ? `SELECT * FROM ${this.q('capability_offers')} WHERE team_id = $1 ORDER BY published_at ASC` : `SELECT * FROM ${this.q('capability_offers')} ORDER BY published_at ASC`;
    const rows = (await this.pool.query(sql, teamId ? [teamId] : [])).rows as Row[];
    return values(rows.map((r) => this.asOffer(r)));
  }

  async shareCapability(share: NewCapabilityShare) {
    const admitted = admit(CapabilityShareSchema, { ...share, sharedAt: share.sharedAt ?? new Date().toISOString() }, 'capability share');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const s = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('capability_shares')} (instance_id, capability, to_team_id, shared_at, shared_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (instance_id, capability, to_team_id) DO UPDATE SET shared_at = now(), shared_by = EXCLUDED.shared_by`,
        [s.instanceId, s.capability, s.toTeamId, s.sharedAt, s.sharedBy]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'capability offer', id: `${s.instanceId}/${s.capability}` });
      throw error;
    }
    return ok(s);
  }

  /**
   * Revocation propagates to bindings as `stale`, not deletion (D42): a running application keeps its
   * configuration while the *intent* to share is withdrawn. Done as one statement, because a read-then-write
   * here would let a concurrent bind slip through as `bound` against a share that had just gone.
   */
  async revokeCapabilityShare(instanceId: string, capability: string, toTeamId: string) {
    const deleted = await this.pool.query(`DELETE FROM ${this.q('capability_shares')} WHERE instance_id = $1 AND capability = $2 AND to_team_id = $3`, [instanceId, capability, toTeamId]);
    if (((deleted.rowCount ?? 0) === 0)) return err({ code: 'not-found', what: 'capability share', id: `${instanceId}/${capability}/${toTeamId}` });
    await this.pool.query(
      `UPDATE ${this.q('capability_bindings')} b SET state = 'stale'
        WHERE b.provider_instance_id = $1 AND b.capability = $2 AND b.state = 'bound'
          AND NOT EXISTS (
            SELECT 1 FROM ${this.q('capability_shares')} s
             WHERE s.instance_id = $1 AND s.capability = $2
               AND (s.to_team_id = (SELECT i.team_id FROM ${this.q('instances')} i WHERE i.id = b.consumer_instance_id) OR s.to_team_id = '*')
          )`,
      [instanceId, capability]);
    return ok({ revoked: true });
  }

  async listCapabilityShares(instanceId: string, capability?: string) {
    const sql = capability
      ? `SELECT * FROM ${this.q('capability_shares')} WHERE instance_id = $1 AND capability = $2 ORDER BY shared_at ASC`
      : `SELECT * FROM ${this.q('capability_shares')} WHERE instance_id = $1 ORDER BY shared_at ASC`;
    const rows = (await this.pool.query(sql, capability ? [instanceId, capability] : [instanceId])).rows as Row[];
    return values(rows.map((r) => {
      const admitted = admit(CapabilityShareSchema, { instanceId: r.instance_id, capability: r.capability, toTeamId: r.to_team_id, sharedAt: iso(r.shared_at), sharedBy: r.shared_by }, 'capability share row');
      return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
    }));
  }

  async availableOffersForTeam(teamId: string, capability?: string) {
    const cap = capability ? ' AND o.capability = $3' : '';
    const params = capability ? [teamId, teamId, capability] : [teamId, teamId];
    const rows = (await this.pool.query(
      `SELECT o.* FROM ${this.q('capability_offers')} o
        WHERE (o.team_id = $1 OR EXISTS (
                 SELECT 1 FROM ${this.q('capability_shares')} s
                  WHERE s.instance_id = o.instance_id AND s.capability = o.capability
                    AND (s.to_team_id = $2 OR s.to_team_id = '*')))${cap}
        ORDER BY o.published_at ASC`, params)).rows as Row[];
    return values(rows.map((r) => this.asOffer(r)));
  }

  async bindCapability(binding: NewBinding) {
    const admitted = admit(BindingRecordSchema, { ...binding, boundAt: binding.boundAt ?? new Date().toISOString() }, 'binding');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const b = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('capability_bindings')} (consumer_instance_id, capability, provider_instance_id, destinations, state, bound_at, bound_by)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
         ON CONFLICT (consumer_instance_id, capability) DO UPDATE SET provider_instance_id = EXCLUDED.provider_instance_id,
                                                                    destinations = EXCLUDED.destinations, state = EXCLUDED.state,
                                                                    bound_at = now(), bound_by = EXCLUDED.bound_by`,
        [b.consumerInstanceId, b.capability, b.providerInstanceId, JSON.stringify(b.destinations), b.state, b.boundAt, b.boundBy]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23503') return err({ code: 'not-found', what: 'capability offer', id: `${b.providerInstanceId}/${b.capability}` });
      if (code === '23514') return err({ code: 'conflict', reason: 'the provider instance cannot be deleted while this binding exists (RESTRICT)' });
      throw error;
    }
    return ok(b);
  }

  async getBinding(consumerInstanceId: string, capability: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('capability_bindings')} WHERE consumer_instance_id = $1 AND capability = $2`, [consumerInstanceId, capability])).rows as Row[];
    const row = rows[0];
    return row ? this.asBinding(row) : err({ code: 'not-found', what: 'binding', id: `${consumerInstanceId}/${capability}` });
  }

  private asBinding(row: Row): StoreResult<BindingRecord> {
    const admitted = admit(BindingRecordSchema, {
      consumerInstanceId: row.consumer_instance_id, capability: row.capability, providerInstanceId: row.provider_instance_id,
      destinations: row.destinations, state: row.state, boundAt: iso(row.bound_at), boundBy: row.bound_by,
    }, 'binding row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async listBindings(consumerInstanceId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('capability_bindings')} WHERE consumer_instance_id = $1 ORDER BY bound_at ASC`, [consumerInstanceId])).rows as Row[];
    return values(rows.map((r) => this.asBinding(r)));
  }

  async listConsumers(providerInstanceId: string, capability?: string) {
    const sql = capability
      ? `SELECT * FROM ${this.q('capability_bindings')} WHERE provider_instance_id = $1 AND capability = $2 ORDER BY bound_at ASC`
      : `SELECT * FROM ${this.q('capability_bindings')} WHERE provider_instance_id = $1 ORDER BY bound_at ASC`;
    const rows = (await this.pool.query(sql, capability ? [providerInstanceId, capability] : [providerInstanceId])).rows as Row[];
    return values(rows.map((r) => this.asBinding(r)));
  }

  async unbindCapability(consumerInstanceId: string, capability: string) {
    const removed = await this.pool.query(`DELETE FROM ${this.q('capability_bindings')} WHERE consumer_instance_id = $1 AND capability = $2`, [consumerInstanceId, capability]);
    if ((removed.rowCount ?? 0) === 0) return err({ code: 'not-found', what: 'binding', id: `${consumerInstanceId}/${capability}` });
    return ok({ removed: true });
  }

  async resolvePerson(input: { issuer: string; subject: string; kind?: Person['kind']; label?: string }) {
    const existing = await this.pool.query(`SELECT person_id FROM ${this.q('identities')} WHERE issuer = $1 AND subject = $2`, [input.issuer, input.subject]);
    const found = (existing.rows as Row[])[0];
    if (found) {
      const person = await this.getPerson(String(found.person_id));
      if (person.ok) return ok({ person: person.value, created: false });
    }
    const id = newId('person');
    try {
      await this.pool.query(`INSERT INTO ${this.q('persons')} (id, kind, label) VALUES ($1,$2,$3)`, [id, input.kind ?? 'human', input.label ?? null]);
    } catch (error) {
      // A concurrent first request can win the insert. Re-read instead of failing someone's login, because the
      // losing request knows the person exists by definition of having looked.
      if ((error as { code?: string }).code === '23505') {
        const again = await this.pool.query(`SELECT person_id FROM ${this.q('identities')} WHERE issuer = $1 AND subject = $2`, [input.issuer, input.subject]);
        const row = (again.rows as Row[])[0];
        if (row) {
          const person = await this.getPerson(String(row.person_id));
          if (person.ok) return ok({ person: person.value, created: false });
        }
      }
      throw error;
    }
    const linked = await this.linkIdentity({ personId: id, issuer: input.issuer, subject: input.subject });
    if (!linked.ok) return err({ code: 'conflict', reason: `identity link refused: ${reasonOf(linked)}` });
    const created = await this.getPerson(id);
    return created.ok ? ok({ person: created.value, created: true }) : err({ code: 'conflict', reason: reasonOf(created) });
  }

  async getPerson(id: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('persons')} WHERE id = $1`, [id])).rows as Row[];
    const row = rows[0];
    if (!row) return err({ code: 'not-found', what: 'person', id });
    const admitted = admit(PersonSchema, { id: row.id, kind: row.kind, ...(row.label === null ? {} : { label: String(row.label) }), createdAt: iso(row.created_at) }, 'person row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async listPersons() {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('persons')} ORDER BY created_at ASC`)).rows as Row[];
    return values(rows.map((r) => {
      const admitted = admit(PersonSchema, { id: r.id, kind: r.kind, ...(r.label === null ? {} : { label: String(r.label) }), createdAt: iso(r.created_at) }, 'person row');
      return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
    }));
  }

  async linkIdentity(input: { personId: string; issuer: string; subject: string }) {
    const admitted = admit(IdentitySchema, { ...input, verifiedAt: new Date().toISOString() }, 'identity');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const i = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('identities')} (issuer, subject, person_id, verified_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (issuer, subject) DO UPDATE SET person_id = EXCLUDED.person_id, verified_at = now()`,
        [i.issuer, i.subject, i.personId, i.verifiedAt]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'person', id: i.personId });
      throw error;
    }
    return ok(i);
  }

  async unlinkIdentity(issuer: string, subject: string) {
    const removed = await this.pool.query(`DELETE FROM ${this.q('identities')} WHERE issuer = $1 AND subject = $2`, [issuer, subject]);
    if ((removed.rowCount ?? 0) === 0) return err({ code: 'not-found', what: 'identity', id: `${issuer}/${subject}` });
    return ok({ removed: true });
  }

  async listIdentities(personId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('identities')} WHERE person_id = $1 ORDER BY verified_at ASC`, [personId])).rows as Row[];
    return values(rows.map((r) => {
      const admitted = admit(IdentitySchema, { issuer: r.issuer, subject: r.subject, personId: r.person_id, verifiedAt: iso(r.verified_at) }, 'identity row');
      return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
    }));
  }

  async getPersonByIdentity(issuer: string, subject: string) {
    const rows = (await this.pool.query(`SELECT person_id FROM ${this.q('identities')} WHERE issuer = $1 AND subject = $2`, [issuer, subject])).rows as Row[];
    const row = rows[0];
    if (!row) return err({ code: 'not-found', what: 'person', id: `${issuer}/${subject}` });
    return this.getPerson(String(row.person_id));
  }

  async createInvitation(input: NewInvitation) {
    const email = normaliseEmail(input.email);
    const now = new Date();
    const expires = new Date(now.getTime() + (input.ttlDays ?? 14) * 86_400_000);
    const admitted = admit(InvitationSchema, {
      id: newId('inv'), teamId: input.teamId, email, role: input.role, state: 'pending', invitedBy: input.invitedBy,
      createdAt: now.toISOString(), expiresAt: expires.toISOString(),
    }, 'invitation');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const i = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('invitations')} (id, team_id, email, role, state, invited_by, created_at, expires_at)
         VALUES ($1,$2,$3,$4,'pending',$5,$6,$7)`,
        [i.id, i.teamId, i.email, i.role, i.invitedBy, i.createdAt, i.expiresAt]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23505') return err({ code: 'conflict', reason: `a pending invitation already exists for ${email} in this team` });
      if (code === '23503') return err({ code: 'not-found', what: 'team', id: i.teamId });
      throw error;
    }
    return ok(i);
  }

  private asInvitation(row: Row): StoreResult<Invitation> {
    const admitted = admit(InvitationSchema, {
      id: row.id, teamId: row.team_id, email: row.email, role: row.role, state: row.state, invitedBy: row.invited_by,
      createdAt: iso(row.created_at), expiresAt: iso(row.expires_at),
      ...(row.accepted_by === null ? {} : { acceptedBy: String(row.accepted_by) }),
      ...(row.accepted_at === null ? {} : { acceptedAt: iso(row.accepted_at) }),
      ...(row.revoked_at === null ? {} : { revokedAt: iso(row.revoked_at) }),
      ...(row.email_receipt === null ? {} : { emailReceipt: String(row.email_receipt) }),
      ...(row.email_error === null ? {} : { emailError: String(row.email_error) }),
    }, 'invitation row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  /**
   * Reads pass through this so an expired pending row is reported as `expired` by BOTH drivers. The double
   * aged on read and Postgres did not, and the shared suite caught the disagreement: an invitation that reads
   * `pending` but refuses acceptance is the kind of answer that makes a UI lie.
   */
  private ageRow(row: Row): Row {
    if (row.state === 'pending' && Date.parse(iso(row.expires_at)) <= Date.now()) return { ...row, state: 'expired' };
    return row;
  }

  async getInvitation(id: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('invitations')} WHERE id = $1`, [id])).rows as Row[];
    const row = rows[0];
    if (!row) return err({ code: 'not-found', what: 'invitation', id });
    return this.asInvitation(row);
  }

  async listInvitations(teamId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('invitations')} WHERE team_id = $1 ORDER BY created_at DESC`, [teamId])).rows as Row[];
    return values(rows.map((r) => this.asInvitation(this.ageRow(r))));
  }

  async findInvitationsForEmail(email: string) {
    const wanted = normaliseEmail(email);
    const rows = (await this.pool.query(
      `SELECT * FROM ${this.q('invitations')} WHERE email = lower($1) ORDER BY created_at DESC`, [wanted])).rows as Row[];
    return values(rows.map((r) => this.asInvitation(this.ageRow(r))));
  }

  async acceptInvitation(invitationId: string, personId: string) {
    // One transaction: a membership without a recorded acceptance, or an acceptance that grants nothing, are
    // both real states a two-statement version can reach when the second call fails. The double has no
    // transaction; the shared suite asserts the outcome, which is why both had better have it.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows = (await client.query(
        `UPDATE ${this.q('invitations')} SET state = 'accepted', accepted_by = $2, accepted_at = now()
          WHERE id = $1 AND state = 'pending' AND expires_at > now() RETURNING *`, [invitationId, personId])).rows as Row[];
      const updated = rows[0];
      if (!updated) {
        await client.query('ROLLBACK');
        const existing = await this.getInvitation(invitationId);
        if (!existing.ok) return err({ code: 'not-found', what: 'invitation', id: invitationId });
        return err({ code: 'conflict', reason: `invitation is ${existing.value.state} and cannot be accepted` });
      }
      const invitation = this.asInvitation(updated);
      if (!invitation.ok) { await client.query('ROLLBACK'); return invitation; }
      const memberRows = (await client.query(
        `INSERT INTO ${this.q('team_members')} (team_id, person_id, role, added_at)
         VALUES ($1,$2,$3,now())
         ON CONFLICT (team_id, person_id) DO UPDATE SET role = EXCLUDED.role
         RETURNING *`, [updated.team_id, personId, updated.role])).rows as Row[];
      const member = memberRows[0];
      if (!member) { await client.query('ROLLBACK'); return err({ code: 'conflict', reason: 'membership write returned nothing' }); }
      await client.query('COMMIT');
      const admittedMember = admit(TeamMemberSchema, { teamId: member.team_id, personId: member.person_id, role: member.role, addedAt: iso(member.added_at) }, 'team member row');
      if (!admittedMember.accepted) return err({ code: 'conflict', reason: admittedMember.reason });
      return ok({ invitation: invitation.value, member: admittedMember.value });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeInvitation(id: string) {
    const rows = (await this.pool.query(
      `UPDATE ${this.q('invitations')} SET state = 'revoked', revoked_at = now()
        WHERE id = $1 AND state IN ('pending','expired') RETURNING *`, [id])).rows as Row[];
    const row = rows[0];
    if (!row) {
      const existing = await this.getInvitation(id);
      if (!existing.ok) return existing;
      return err({ code: 'conflict', reason: `invitation is ${existing.value.state} and cannot be revoked` });
    }
    return this.asInvitation(row);
  }

  async setInvitationEmailResult(id: string, result: { receipt?: string; error?: string }) {
    const rows = (await this.pool.query(
      `UPDATE ${this.q('invitations')}
          SET email_receipt = COALESCE($2, email_receipt), email_error = COALESCE($3, email_error)
        WHERE id = $1 RETURNING *`, [id, result.receipt ?? null, result.error ?? null])).rows as Row[];
    const row = rows[0];
    if (!row) return err({ code: 'not-found', what: 'invitation', id });
    return this.asInvitation(row);
  }

  async setInstanceEnvironment(input: { instanceId: string; environment: string; state: Instance['state']; appliedPlanHash?: string; attestationId?: string }) {
    const admitted = admit(InstanceEnvironmentStateSchema, {
      instanceId: input.instanceId, environment: input.environment, state: input.state,
      ...(input.appliedPlanHash === undefined ? {} : { appliedPlanHash: input.appliedPlanHash }),
      ...(input.attestationId === undefined ? {} : { attestationId: input.attestationId }),
      updatedAt: new Date().toISOString(),
    }, 'instance environment state');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const e = admitted.value;
    try {
      // Same patch semantics as the double: an omitted field keeps its previous value rather than being
      // overwritten with null. Both drivers must agree on this or a test written against one passes while the
      // other loses provenance silently.
      await this.pool.query(
        `INSERT INTO ${this.q('instance_environments')} (instance_id, environment, state, applied_plan_hash, last_attestation_id, updated_at)
         VALUES ($1,$2,$3,$4,$5,now())
         ON CONFLICT (instance_id, environment) DO UPDATE SET state = EXCLUDED.state,
           applied_plan_hash = COALESCE(EXCLUDED.applied_plan_hash, ${this.q('instance_environments')}.applied_plan_hash),
           last_attestation_id = COALESCE(EXCLUDED.last_attestation_id, ${this.q('instance_environments')}.last_attestation_id),
           updated_at = now()`,
        [e.instanceId, e.environment, e.state, input.appliedPlanHash ?? null, input.attestationId ?? null]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'instance', id: e.instanceId });
      throw error;
    }
    return ok(e);
  }

  async getInstanceEnvironment(instanceId: string, environment: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('instance_environments')} WHERE instance_id = $1 AND environment = $2`, [instanceId, environment])).rows as Row[];
    const row = rows[0];
    return row ? this.asEnvState(row) : err({ code: 'not-found', what: 'instance environment', id: `${instanceId}/${environment}` });
  }

  private asEnvState(row: Row): StoreResult<InstanceEnvironmentState> {
    const admitted = admit(InstanceEnvironmentStateSchema, {
      instanceId: row.instance_id, environment: row.environment, state: row.state,
      ...(row.applied_plan_hash === null ? {} : { appliedPlanHash: String(row.applied_plan_hash) }),
      ...(row.last_attestation_id === null ? {} : { attestationId: String(row.last_attestation_id) }),
      updatedAt: iso(row.updated_at),
    }, 'instance environment row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async listInstanceEnvironments(instanceId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('instance_environments')} WHERE instance_id = $1 ORDER BY environment ASC`, [instanceId])).rows as Row[];
    return values(rows.map((r) => this.asEnvState(r)));
  }

  async putTeamMember(member: Omit<TeamMember, 'addedAt'> & { addedAt?: string }) {
    const admitted = admit(TeamMemberSchema, { ...member, addedAt: member.addedAt ?? new Date().toISOString() }, 'team member');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const m = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('team_members')} (team_id, person_id, role, added_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (team_id, person_id) DO UPDATE SET role = EXCLUDED.role`,
        [m.teamId, m.personId, m.role, m.addedAt]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') {
        const teamExists = await this.pool.query(`SELECT 1 FROM ${this.q('teams')} WHERE id = $1`, [m.teamId]);
        if ((teamExists.rowCount ?? 0) === 0) return err({ code: 'not-found', what: 'team', id: m.teamId });
        return err({ code: 'not-found', what: 'person', id: m.personId });
      }
      throw error;
    }
    return ok(m);
  }

  async getTeamMember(teamId: string, personId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('team_members')} WHERE team_id = $1 AND person_id = $2`, [teamId, personId])).rows as Row[];
    const row = rows[0];
    if (!row) return err({ code: 'not-found', what: 'team membership', id: `${teamId}/${personId}` });
    const admitted = admit(TeamMemberSchema, { teamId: row.team_id, personId: row.person_id, role: row.role, addedAt: iso(row.added_at) }, 'team member row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async listTeamMembers(teamId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('team_members')} WHERE team_id = $1 ORDER BY added_at ASC`, [teamId])).rows as Row[];
    return values(rows.map((r) => {
      const admitted = admit(TeamMemberSchema, { teamId: r.team_id, personId: r.person_id, role: r.role, addedAt: iso(r.added_at) }, 'team member row');
      return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
    }));
  }

  async teamsForPerson(personId: string) {
    const rows = (await this.pool.query(`SELECT team_id FROM ${this.q('team_members')} WHERE person_id = $1 ORDER BY added_at ASC`, [personId])).rows as Row[];
    return rows.map((r) => String(r.team_id));
  }

  async putPlan(instanceId: string, plan: unknown, planHash: string) {
    if (!plan || typeof plan !== 'object') return err({ code: 'conflict', reason: 'plan must be an object' });
    if (!/^[0-9a-f]{64}$/.test(planHash)) return err({ code: 'conflict', reason: `plan hash is not a bare 64-hex digest: ${planHash.slice(0, 24)}` });
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('plans')} (instance_id, plan_hash, plan, registered_at) VALUES ($1,$2,$3::jsonb, now())
         ON CONFLICT (instance_id) DO UPDATE SET plan_hash = EXCLUDED.plan_hash, plan = EXCLUDED.plan, registered_at = now()`,
        [instanceId, planHash, JSON.stringify(plan)]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'instance', id: instanceId });
      throw error;
    }
    return ok({ instanceId, planHash });
  }

  async getPlan(instanceId: string) {
    const rows = (await this.pool.query(`SELECT instance_id, plan_hash, plan FROM ${this.q('plans')} WHERE instance_id = $1`, [instanceId])).rows as Row[];
    const row = rows[0];
    return row ? ok({ instanceId: String(row.instance_id), planHash: String(row.plan_hash), plan: row.plan }) : err({ code: 'not-found', what: 'plan', id: instanceId });
  }

  async createDispatch(input: Omit<DispatchRecord, 'id' | 'consumedAt'> & { id?: string }) {
    const admitted = admit(DispatchRecordSchema, { ...input, id: input.id ?? newId('disp'), consumedAt: null }, 'dispatch');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const d = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('dispatches')} (id, instance_id, nonce, plan_hash, action, environment, issued_at, expires_at, plan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [d.id, d.instanceId, d.nonce, d.planHash, d.action, d.environment, d.issuedAt, d.expiresAt, JSON.stringify(d.plan)]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23503') return err({ code: 'not-found', what: 'instance', id: d.instanceId });
      if (code === '23505') return err({ code: 'conflict', reason: `dispatch ${d.id} already exists` });
      throw error;
    }
    return ok(d);
  }

  async getDispatch(id: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('dispatches')} WHERE id = $1`, [id])).rows as Row[];
    const row = rows[0];
    return row ? this.asDispatch(row) : err({ code: 'not-found', what: 'dispatch', id });
  }

  private asDispatch(row: Row): StoreResult<DispatchRecord> {
    const admitted = admit(DispatchRecordSchema, {
      id: row.id, instanceId: row.instance_id, nonce: row.nonce, planHash: row.plan_hash, action: row.action, environment: row.environment,
      issuedAt: iso(row.issued_at), expiresAt: iso(row.expires_at), consumedAt: row.consumed_at === null ? null : iso(row.consumed_at), plan: row.plan,
    }, 'dispatch row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  /**
   * Single use, atomically. `WHERE consumed_at IS NULL` means two runners racing on one dispatch produce one
   * winner: the loser gets zero rows back. The memory double achieves the same contract with a check, which is
   * safe there because it is one process -- this is why the suite tests behaviour, not implementation.
   */
  async consumeDispatch(id: string, at?: string) {
    const when = at ?? new Date().toISOString();
    const rows = (await this.pool.query(
      `UPDATE ${this.q('dispatches')} SET consumed_at = $2
        WHERE id = $1 AND consumed_at IS NULL AND expires_at > $2::timestamptz
        RETURNING *`,
      [id, when])).rows as Row[];
    const row = rows[0];
    if (row) return this.asDispatch(row);
    const existing = (await this.pool.query(`SELECT consumed_at, expires_at FROM ${this.q('dispatches')} WHERE id = $1`, [id])).rows as Row[];
    const current = existing[0];
    if (!current) return err({ code: 'not-found', what: 'dispatch', id });
    if (current.consumed_at !== null) return err({ code: 'consumed', reason: `dispatch ${id} was consumed at ${String(current.consumed_at)}` });
    return err({ code: 'expired', reason: `dispatch ${id} expired at ${String(current.expires_at)}` });
  }

  async listDispatches(instanceId: string, limit = 50) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('dispatches')} WHERE instance_id = $1 ORDER BY issued_at DESC, id DESC LIMIT $2`, [instanceId, limit])).rows as Row[];
    return values(rows.map((r) => this.asDispatch(r)));
  }

  async recordAttestation(attestation: Attestation, receivedAt?: string, actor: { kind?: AttestationRecord['actorKind']; ref?: string } = {}) {
    const dispatch = await this.getDispatch(attestation.dispatchId);
    const verdict = checkAttestationPolicy(attestation, dispatch.ok ? dispatch.value : null);
    if (verdict.ok === false) return err(verdict.error);
    const admitted = admit(AttestationRecordSchema, {
      ...attestation, receivedAt: receivedAt ?? new Date().toISOString(), actorKind: actor.kind ?? 'shared-secret',
      ...(actor.ref === undefined ? {} : { actorRef: actor.ref }),
    }, 'attestation');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const a = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('attestations')}
           (dispatch_id, instance_id, result, plan_hash, nonce, action, environment, error_code, resources, release, duration_ms, finished_at, received_at, actor_kind, actor_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)`,
        [a.dispatchId, a.instanceId, a.result, a.planHash, a.nonce, a.action, a.environment, a.errorCode ?? null,
          JSON.stringify(a.resources ?? []), JSON.stringify(a.release), a.durationMs, a.finishedAt, a.receivedAt, a.actorKind, a.actorRef ?? null]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return err({ code: 'conflict', reason: `dispatch ${a.dispatchId} already attested` });
      throw error;
    }
    return ok(a);
  }

  async getAttestation(dispatchId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('attestations')} WHERE dispatch_id = $1`, [dispatchId])).rows as Row[];
    const row = rows[0];
    return row ? this.asAttestation(row) : err({ code: 'not-found', what: 'attestation', id: dispatchId });
  }

  private asAttestation(row: Row): StoreResult<AttestationRecord> {
    const admitted = admit(AttestationRecordSchema, {
      dispatchId: row.dispatch_id, instanceId: row.instance_id, result: row.result, planHash: row.plan_hash, nonce: row.nonce,
      action: row.action, environment: row.environment,
      ...(row.error_code === null ? {} : { errorCode: String(row.error_code) }),
      resources: row.resources, release: row.release, durationMs: Number(row.duration_ms),
      finishedAt: iso(row.finished_at), receivedAt: iso(row.received_at), actorKind: row.actor_kind,
      ...(row.actor_ref === null ? {} : { actorRef: String(row.actor_ref) }),
    }, 'attestation row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async latestAttestation(instanceId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('attestations')} WHERE instance_id = $1 ORDER BY finished_at DESC, received_at DESC, dispatch_id DESC LIMIT 1`, [instanceId])).rows as Row[];
    const row = rows[0];
    return row ? this.asAttestation(row) : err({ code: 'not-found', what: 'attestation', id: instanceId });
  }

  async listAttestations(instanceId: string, limit = 50) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('attestations')} WHERE instance_id = $1 ORDER BY finished_at DESC, received_at DESC, dispatch_id DESC LIMIT $2`, [instanceId, limit])).rows as Row[];
    return values(rows.map((r) => this.asAttestation(r)));
  }

  async appendAudit(entry: Omit<AuditEntry, 'id' | 'at'> & { at?: string }) {
    const admitted = admit(AuditEntrySchema, { ...entry, id: newId('aud'), at: entry.at ?? new Date().toISOString() }, 'audit entry');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const e = admitted.value;
    await this.pool.query(
      `INSERT INTO ${this.q('audit_log')} (id, at, actor_kind, actor_ref, action, target, detail) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [e.id, e.at, e.actorKind, e.actorRef, e.action, e.target, JSON.stringify(e.detail)]);
    return ok(e);
  }

  /** Ordered by the insertion counter, not by `at`: three rows sharing one statement timestamp made `at DESC` a coin flip, which CI caught and my laptop did not. */
  async recentAudit(limit = 50) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('audit_log')} ORDER BY seq DESC LIMIT $1`, [limit])).rows as Row[];
    return rows.map((r) => {
      const admitted = admit(AuditEntrySchema, { id: r.id, at: iso(r.at), actorKind: r.actor_kind, actorRef: r.actor_ref, action: r.action, target: r.target, detail: r.detail }, 'audit row');
      return admitted.accepted ? admitted.value : undefined;
    }).filter((x): x is AuditEntry => x !== undefined);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ready = false;
    await this.pool.end();
  }
}
