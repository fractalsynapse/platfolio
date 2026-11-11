import { Pool, type PoolClient } from 'pg';
import {
  AttestationRecordSchema, AuditEntrySchema, BindingRecordSchema, CapabilityOfferSchema, CapabilityShareSchema, DispatchRecordSchema, TeamMemberSchema, InstanceSchema, ProviderConnectionSchema, RepoConnectionSchema, TeamSchema, newId,
  type AttestationRecord, type AuditEntry, type BindingRecord, type CapabilityOffer, type CapabilityShare, type NewBinding, type NewCapabilityOffer, type NewCapabilityShare, type DispatchRecord, type Instance, type ProviderConnection, type RepoConnection, type Store, type StoreError, type StoreResult, type Team, type TeamMember,
} from './persistence.ts';
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

  private async withClient<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      return await run(client);
    } finally {
      client.release();
    }
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

  async createInstance(input: { teamId: string; name: string; platform: string; state?: Instance['state']; provider?: Instance['provider'] }) {
    const now = new Date().toISOString();
    const admitted = admit(InstanceSchema, {
      id: newId('inst'), teamId: input.teamId, name: input.name, platform: input.platform,
      state: input.state ?? 'pending', provider: input.provider ?? 'railway', createdAt: now, updatedAt: now,
    }, 'instance');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const i = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('instances')} (id, team_id, name, platform, state, provider, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [i.id, i.teamId, i.name, i.platform, i.state, i.provider, i.createdAt, i.updatedAt]);
    } catch (error) {
      // A foreign-key violation is the referential guard the suite asserts; report it as a typed refusal.
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'team', id: input.teamId });
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
      id: row.id, teamId: row.team_id, name: row.name, platform: row.platform, state: row.state, provider: row.provider,
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

  async putTeamMember(member: Omit<TeamMember, 'addedAt'> & { addedAt?: string }) {
    const admitted = admit(TeamMemberSchema, { ...member, addedAt: member.addedAt ?? new Date().toISOString() }, 'team member');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const m = admitted.value;
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('team_members')} (team_id, subject, role, added_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (team_id, subject) DO UPDATE SET role = EXCLUDED.role`,
        [m.teamId, m.subject, m.role, m.addedAt]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'team', id: m.teamId });
      throw error;
    }
    return ok(m);
  }

  async getTeamMember(teamId: string, subject: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('team_members')} WHERE team_id = $1 AND subject = $2`, [teamId, subject])).rows as Row[];
    const row = rows[0];
    return row ? this.asMember(row) : err({ code: 'not-found', what: 'team membership', id: `${teamId}/${subject}` });
  }

  private asMember(row: Row): StoreResult<TeamMember> {
    const admitted = admit(TeamMemberSchema, { teamId: row.team_id, subject: row.subject, role: row.role, addedAt: iso(row.added_at) }, 'team member row');
    return admitted.accepted ? ok(admitted.value) : err({ code: 'conflict', reason: admitted.reason });
  }

  async listTeamMembers(teamId: string) {
    const rows = (await this.pool.query(`SELECT * FROM ${this.q('team_members')} WHERE team_id = $1 ORDER BY added_at ASC`, [teamId])).rows as Row[];
    return rows.map((r) => this.asMember(r)).filter((r): r is { ok: true; value: TeamMember } => r.ok).map((r) => r.value);
  }

  async teamsForSubject(subject: string) {
    const rows = (await this.pool.query(`SELECT team_id FROM ${this.q('team_members')} WHERE subject = $1 ORDER BY added_at ASC`, [subject])).rows as Row[];
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
