import type { HubSignInTrust, Identity } from './persistence.ts';
import {
  MarketplaceAcquisitionReceiptSchema, MarketplacePlatformAliasSchema, MarketplacePlatformDescriptorSchema, MarketplacePublisherPlatformSchema, MarketplaceReleasePublicationSchema,
  type MarketplacePlatformAcquisitionInput, type MarketplacePlatformCreation, type MarketplacePlatformDescriptor, type MarketplaceReleasePublication,
} from './marketplace-release.ts';
import { MarketplaceInstallRecordSchema, type VerifiedMarketplaceInstall } from './marketplace-install.ts';
import { InstallationJournalSchema, type InstallationJournal } from './installation-journal.ts';
import { z } from 'zod';
import { IdentityClientTargetSchema, type IdentityClientTarget } from './shared-identity-execution.ts';
import { Pool, type PoolClient } from 'pg';
import {
  HostedStarterSchema, MarketplaceInstallationSchema, NotificationRuleSchema, rollupState, type NewNotificationRule, type NotificationRule, type HostedStarter, type NewHostedStarter, type HostedAppCheck,
  ArtifactRecordSchema, AttestationRecordSchema, AuditEntrySchema, BindingRecordSchema, CapabilityOfferSchema, CapabilityShareSchema, DispatchRecordSchema, IdentitySchema, PersonSchema, TeamMemberSchema, InstanceEnvironmentStateSchema, InstanceSchema, InvitationSchema, ProviderConnectionSchema, RepoConnectionSchema, TeamSchema, newId,
  type ArtifactRecord, type AttestationRecord, type AuditEntry, type BindingRecord, type CapabilityOffer, type NewBinding, type NewCapabilityOffer, type NewCapabilityShare, type DispatchRecord, type Instance, type InstanceEnvironmentState, type Invitation, type NewInvitation, type ProviderConnection, type RepoConnection, type Store, type StoreError, type NewInstance, type StoreResult, type Team, type Person, type TeamMember, type TeamRole,
} from './persistence.ts';
import { reasonOf } from './persistence.ts';
import { normaliseEmail, normaliseName } from './persistence.ts';
import { checkAttestationPolicy } from './dispatch-policy.ts';
import type { Attestation } from './attestation.ts';
import { nextAppCheck } from './hosted-availability.ts';
import { notificationEvents } from './notification-events.ts';
import type { NotificationEmailDelivery, NotificationEmailPreference } from './persistence.ts';
import { CONTRACT_VERSION } from './generated/contract-version.ts';

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

  async listInstallationJournals(teamId: string, personId: string) {
    const result = await this.pool.query(
      `SELECT document FROM ${this.q('installation_journals')} WHERE team_id = $1 AND person_id = $2 ORDER BY name, id`, [teamId, personId]);
    return result.rows.map(({ document }) => InstallationJournalSchema.parse(document));
  }

  async getInstallationJournal(teamId: string, personId: string, id: string) {
    if (!z.uuid().safeParse(id).success) return;
    const result = await this.pool.query(
      `SELECT document FROM ${this.q('installation_journals')} WHERE team_id = $1 AND person_id = $2 AND id = $3`, [teamId, personId, id]);
    const first = result.rows[0];
    return first ? InstallationJournalSchema.parse(first.document) : undefined;
  }

  async saveInstallationJournal(input: InstallationJournal): Promise<boolean> {
    const parsed = InstallationJournalSchema.safeParse(input);
    if (this.closed || !parsed.success) return false;
    const next = parsed.data;
    const table = this.q('installation_journals');
    const fields = [next.id, next.teamId, next.personId, next.workspaceId, next.provider, next.name, next.version, next];
    const result = next.version === 0
      ? await this.pool.query(
        `INSERT INTO ${table} (id, team_id, person_id, workspace_id, provider, name, version, document)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`, fields)
      : await this.pool.query(
        `UPDATE ${table} SET version = $7, document = $8 WHERE id = $1 AND team_id = $2 AND person_id = $3
         AND workspace_id = $4 AND provider = $5 AND name = $6 AND version = $7::integer - 1`, fields);
    return result.rowCount === 1;
  }

  describe() {
    return { driver: this.driver, contract: CONTRACT_VERSION, schemaReady: this.ready };
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

  async connectMarketplaceInstallation(teamId: string, installationId: string): Promise<boolean> {
    const table = this.q('marketplace_links');
    const result = await this.pool.query(
      `INSERT INTO ${table} AS link (installation_id, team_id)
       SELECT $1, id FROM ${this.q('teams')} WHERE id = $2
       ON CONFLICT (installation_id) DO UPDATE SET team_id = link.team_id
       WHERE link.team_id = EXCLUDED.team_id AND NOT link.disconnected AND link.enrollment_digest IS NULL
       RETURNING installation_id`, [installationId, teamId],
    );
    return result.rowCount === 1;
  }

  async marketplaceInstallationConnected(teamId: string, installationId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT installation_id FROM ${this.q('marketplace_links')}
       WHERE installation_id = $1 AND team_id = $2 AND NOT disconnected AND enrollment_digest IS NULL`, [installationId, teamId],
    );
    return result.rowCount === 1;
  }

  async listMarketplaceInstallations(teamId: string) {
    const result = await this.pool.query(
      `SELECT installation_id AS "installationId",
              CASE WHEN disconnected THEN 'disconnected'
                   WHEN registry_digest IS NOT NULL THEN 'connected'
                   WHEN enrollment_digest IS NOT NULL THEN 'pending'
                   ELSE 'linked' END AS state
       FROM ${this.q('marketplace_links')} WHERE team_id = $1 ORDER BY installation_id`, [teamId],
    );
    return result.rows.map((row) => MarketplaceInstallationSchema.parse(row));
  }

  async disconnectMarketplaceInstallation(teamId: string, installationId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.q('marketplace_links')}
       SET disconnected = TRUE, enrollment_digest = NULL, enrollment_expires_at = NULL, registry_digest = NULL
       WHERE installation_id = $1 AND team_id = $2`, [installationId, teamId],
    );
    return result.rowCount === 1;
  }

  async issueMarketplaceEnrollment(teamId: string, installationId: string, digest: string, expiresAt: string): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO ${this.q('marketplace_links')} AS link (installation_id, team_id, enrollment_digest, enrollment_expires_at)
       SELECT $1, id, $3, $4::timestamptz FROM ${this.q('teams')} WHERE id = $2
       ON CONFLICT (installation_id) DO UPDATE
       SET enrollment_digest = EXCLUDED.enrollment_digest, enrollment_expires_at = EXCLUDED.enrollment_expires_at
       WHERE link.team_id = EXCLUDED.team_id AND NOT link.disconnected AND link.enrollment_digest IS NOT NULL
       RETURNING installation_id`, [installationId, teamId, digest, expiresAt],
    );
    return result.rowCount === 1;
  }

  async redeemMarketplaceEnrollment(installationId: string, enrollmentDigest: string, registryDigest: string, now: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${this.q('marketplace_links')}
       SET enrollment_digest = NULL, enrollment_expires_at = NULL, registry_digest = $3
       WHERE installation_id = $1 AND enrollment_digest = $2 AND enrollment_expires_at > $4 AND NOT disconnected`,
      [installationId, enrollmentDigest, registryDigest, now],
    );
    return result.rowCount === 1;
  }

  async listMarketplacePlatformAliases() {
    const result = await this.pool.query(
      `SELECT id, variant, legacy_template AS "legacyTemplate" FROM ${this.q('marketplace_platforms')}
       WHERE legacy_template IS NOT NULL ORDER BY id`,
    );
    return result.rows.map((row) => MarketplacePlatformAliasSchema.parse(row));
  }

  async createMarketplacePlatform(teamId: string, input: MarketplacePlatformCreation) {
    const platform = MarketplacePublisherPlatformSchema.parse({ ...input, id: newId('platform'), publisherTeamId: teamId });
    const result = await this.pool.query(
      `INSERT INTO ${this.q('marketplace_platforms')} (id, variant, publisher_team_id, slug, title)
       SELECT $1, $2, id, $4, $5 FROM ${this.q('teams')} WHERE id = $3
       ON CONFLICT (publisher_team_id, slug) DO NOTHING`,
      [platform.id, platform.variant, teamId, platform.slug, platform.title],
    );
    if (result.rowCount === 1) return ok(platform);
    const team = await this.getTeam(teamId);
    return team.ok ? err({ code: 'conflict', reason: 'A platform with that slug already exists for this team.' }) : err(team);
  }

  async getMarketplacePublisherPlatform(teamId: string, platformId: string) {
    const result = await this.pool.query(
      `SELECT id, variant, slug, title, publisher_team_id AS "publisherTeamId" FROM ${this.q('marketplace_platforms')}
       WHERE id = $1 AND publisher_team_id = $2`, [platformId, teamId],
    );
    return result.rows[0] ? MarketplacePublisherPlatformSchema.parse(result.rows[0]) : undefined;
  }

  async publishMarketplacePlatformRelease(teamId: string, input: MarketplacePlatformDescriptor) {
    const descriptor = MarketplacePlatformDescriptorSchema.parse(input);
    const args = [descriptor.platformId, descriptor.version, descriptor, teamId];
    const platforms = this.q('marketplace_platforms');
    const releases = this.q('marketplace_platform_releases');
    const result = await this.pool.query(
      `INSERT INTO ${releases} (platform_id, version, descriptor)
       SELECT id, $2, $3 FROM ${platforms} WHERE id = $1 AND publisher_team_id = $4
       ON CONFLICT (platform_id, version) DO NOTHING`, args,
    );
    if (result.rowCount === 1) return 'created';
    const previous = await this.pool.query(
      `SELECT release.descriptor = $3::jsonb AS matches FROM ${releases} AS release
       JOIN ${platforms} AS platform ON platform.id = release.platform_id
       WHERE release.platform_id = $1 AND release.version = $2 AND platform.publisher_team_id = $4`, args,
    );
    const existing = previous.rows[0];
    return existing ? (existing.matches ? 'existing' : 'conflict') : 'not-found';
  }

  async listMarketplacePublishedPlatformReleases() {
    const result = await this.pool.query(
      `SELECT platform.id, platform.variant, platform.slug, platform.title, platform.publisher_team_id AS "publisherTeamId",
              release.descriptor
       FROM ${this.q('marketplace_platform_releases')} AS release
       JOIN ${this.q('marketplace_platforms')} AS platform ON platform.id = release.platform_id`,
    );
    return result.rows.map(({ descriptor, ...platform }) => ({
      platform: MarketplacePublisherPlatformSchema.parse(platform),
      descriptor: MarketplacePlatformDescriptorSchema.parse(descriptor),
    }));
  }

  async setMarketplaceMaintenance(publisherTeamId: string, platformId: string, buyerTeamId: string, through: string) {
    const result = await this.pool.query(
      `INSERT INTO ${this.q('marketplace_maintenance')} (platform_id, buyer_team_id, eligible_through)
       SELECT platform.id, buyer.id, $4::timestamptz FROM ${this.q('marketplace_platforms')} AS platform
       JOIN ${this.q('teams')} AS buyer ON buyer.id = $3
       WHERE platform.publisher_team_id = $1 AND platform.id = $2
       ON CONFLICT (platform_id, buyer_team_id) DO UPDATE SET eligible_through = EXCLUDED.eligible_through`,
      [publisherTeamId, platformId, buyerTeamId, through]);
    return result.rowCount === 1;
  }

  async hasMarketplaceAcquisition(installationId: string, registryDigest: string, release: MarketplacePlatformAcquisitionInput) {
    const result = await this.pool.query(
      `SELECT 1 FROM ${this.q('marketplace_links')} AS link
       JOIN ${this.q('marketplace_platform_acquisitions')} AS receipt ON receipt.team_id = link.team_id
       WHERE link.installation_id = $1 AND link.registry_digest = $2 AND NOT link.disconnected
         AND receipt.platform_id = $3 AND receipt.version = $4 AND receipt.descriptor_digest = $5`,
      [installationId, registryDigest, release.platformId, release.version, release.descriptorDigest]);
    return result.rowCount === 1;
  }

  async acquireMarketplacePlatformRelease(installationId: string, registryDigest: string, release: MarketplacePlatformAcquisitionInput, requiresMaintenance = false) {
    const result = await this.pool.query(
      `INSERT INTO ${this.q('marketplace_platform_acquisitions')} AS receipt (id, team_id, platform_id, version, descriptor_digest)
       SELECT $3, link.team_id, $4, $5, $6 FROM ${this.q('marketplace_links')} AS link
       WHERE link.installation_id = $1 AND link.registry_digest = $2 AND NOT link.disconnected
         AND (NOT $7::boolean OR EXISTS (
           SELECT 1 FROM ${this.q('marketplace_maintenance')} AS term
           WHERE term.platform_id = $4 AND term.buyer_team_id = link.team_id AND term.eligible_through > now()
         ) OR EXISTS (
           SELECT 1 FROM ${this.q('marketplace_platform_acquisitions')} AS prior
           WHERE prior.platform_id = $4 AND prior.team_id = link.team_id AND prior.version = $5 AND prior.descriptor_digest = $6
         ))
       FOR SHARE OF link
       ON CONFLICT (team_id, platform_id, version) DO UPDATE SET descriptor_digest = receipt.descriptor_digest
       WHERE receipt.descriptor_digest = EXCLUDED.descriptor_digest
       RETURNING id, team_id AS "teamId", acquired_at AS "acquiredAt"`,
      [installationId, registryDigest, newId('acquisition'), release.platformId, release.version, release.descriptorDigest, requiresMaintenance],
    );
    const saved = result.rows[0];
    return saved ? { id: String(saved.id), teamId: String(saved.teamId), acquiredAt: iso(saved.acquiredAt) } : undefined;
  }

  async listMarketplaceReleases() {
    const result = await this.pool.query(
      `SELECT template, version, revision, installer, image FROM ${this.q('marketplace_releases')}`,
    );
    return result.rows.map(({ image, ...release }) => MarketplaceReleasePublicationSchema.parse({
      ...release, ...(image === null ? {} : { image }),
    }));
  }

  async publishMarketplaceRelease(release: MarketplaceReleasePublication) {
    const { template, version, revision, installer, image } = release;
    const result = await this.pool.query(
      `INSERT INTO ${this.q('marketplace_releases')} (template, version, revision, installer, image)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (template, version) DO NOTHING`,
      [template, version, revision, installer, image ?? null],
    );
    if (result.rowCount === 1) return 'created';
    const existing = await this.pool.query(
      `SELECT 1 FROM ${this.q('marketplace_releases')}
       WHERE template = $1 AND version = $2 AND revision = $3 AND installer = $4 AND image IS NOT DISTINCT FROM $5::text`,
      [template, version, revision, installer, image ?? null],
    );
    return existing.rowCount === 1 ? 'existing' : 'conflict';
  }

  async verifyMarketplaceCredential(installationId: string, registryDigest: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT installation_id FROM ${this.q('marketplace_links')}
       WHERE installation_id = $1 AND registry_digest = $2 AND NOT disconnected`, [installationId, registryDigest],
    );
    return result.rowCount === 1;
  }

  async createTeam(input: { name: string }) {
    const name = normaliseName(input.name);
    const admitted = admit(TeamSchema, { id: newId('team'), name, createdAt: new Date().toISOString() }, 'team');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const team = admitted.value;
    try {
      await this.pool.query(`INSERT INTO ${this.q('teams')} (id, name, created_at) VALUES ($1,$2,$3)`, [team.id, team.name, team.createdAt]);
    } catch (error) {
      // The unique index is D45's rule; surface it as the same typed conflict the double raises so neither
      // driver can be the only one that knows.
      if ((error as { code?: string }).code === '23505') return err({ code: 'conflict', reason: `a team named "${name}" already exists` });
      throw error;
    }
    return ok(team);
  }

  async seedInstallationTeam({ id, name, personId }: { id: string; name: string; personId: string }) {
    const admitted = admit(TeamSchema, { id, name, createdAt: new Date().toISOString() }, 'installation team');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const now = admitted.value.createdAt;
    const result = await this.pool.query(
      `WITH inserted AS (
         INSERT INTO ${this.q('teams')} (id, name, created_at)
         SELECT $1,$2,$3::timestamptz FROM ${this.q('persons')} WHERE id = $4
         ON CONFLICT DO NOTHING
         RETURNING id, name, created_at
       ), membership AS (
         INSERT INTO ${this.q('team_members')} (team_id, person_id, role, added_at)
         SELECT id,$4,'owner',$3::timestamptz FROM inserted
       )
       SELECT id, name, created_at FROM inserted`, [id, name, now, personId]);
    if (result.rows[0]) return this.asTeam(result.rows[0] as Row);
    const existing = await this.getTeam(id);
    return existing.ok && existing.value.name === name ? existing : err({ code: 'conflict', reason: 'The predefined installation team could not be created' });
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

  async recordMarketplaceInstall(instance: Instance, verified: VerifiedMarketplaceInstall): Promise<StoreResult<Instance>> {
    const admitted = admit(MarketplaceInstallRecordSchema, { instance, verified }, 'marketplace install');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const { receipt, plan } = admitted.value.verified;
    try {
      await this.pool.query(
        `WITH installed AS (
           INSERT INTO ${this.q('instances')}
             (id, team_id, name, template, template_repo, template_commit, state, provider, created_at, updated_at, marketplace_receipt, desired_plan_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10::jsonb,$11)
           RETURNING id
         )
         INSERT INTO ${this.q('plans')} (instance_id, plan_hash, plan, registered_at)
         SELECT id, $11, $12::jsonb, now() FROM installed WHERE $11 IS NOT NULL`,
        [instance.id, instance.teamId, instance.name, instance.template, instance.templateRef?.repo ?? null,
          instance.templateRef?.commitSha ?? null, instance.state, instance.provider, instance.createdAt,
          JSON.stringify(receipt), plan?.planHash ?? null, plan ? JSON.stringify(plan) : null],
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23503') return err({ code: 'not-found', what: 'team', id: instance.teamId });
      if (code === '23505') return err({ code: 'conflict', reason: 'This name already belongs to an instance' });
      throw error;
    }
    return ok(instance);
  }

  async getMarketplaceInstall(teamId: string, name: string) {
    const row = (await this.pool.query(
      `SELECT * FROM ${this.q('instances')} WHERE team_id = $1 AND name = $2 AND marketplace_receipt IS NOT NULL`,
      [teamId, name],
    )).rows[0] as Row | undefined;
    if (!row) return undefined;
    const instance = this.asInstance(row);
    if (!instance.ok) throw new Error('The stored marketplace instance is invalid');
    return { instance: instance.value, receipt: MarketplaceAcquisitionReceiptSchema.parse(row.marketplace_receipt) };
  }

  async recordHostedStarter(input: NewHostedStarter): Promise<StoreResult<Instance>> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      // All registrations for one team take the same lock. The project uniqueness constraint handles peer teams.
      const team = await client.query(`SELECT id FROM ${this.q('teams')} WHERE id = $1 FOR UPDATE`, [input.teamId]);
      if (!team.rowCount) return err({ code: 'not-found', what: 'team', id: input.teamId });
      const existing = (await client.query(`SELECT * FROM ${this.q('instances')} WHERE team_id = $1 AND name = $2 FOR UPDATE`, [input.teamId, input.name])).rows[0] as Row | undefined;
      const instanceId = existing ? String(existing.id) : newId('inst');
      const current = existing
        ? (await client.query(`SELECT * FROM ${this.q('hosted_starters')} WHERE instance_id = $1`, [instanceId])).rows[0] as Row | undefined
        : undefined;
      if (input.state !== 'live' && !current) return err({ code: 'not-found', what: 'hosted starter', id: input.name });
      const replacement = input.state === 'live' && current?.state === 'removed';
      if (existing && (!current || (!replacement && current.project_id !== input.projectId) || existing.template !== input.template ||
          (!replacement && existing.template_commit !== input.templateRef.commitSha) || existing.template_repo !== input.templateRef.repo)) {
        return err({ code: 'conflict', reason: 'This name already belongs to a different instance' });
      }
      if (existing && current && Date.parse(iso(current.observed_at)) >= Date.parse(input.observedAt)) {
        return this.asInstance(existing);
      }

      const now = new Date().toISOString();
      const otherEnvironments = (await client.query(
        `SELECT environment, state, updated_at FROM ${this.q('instance_environments')} WHERE instance_id = $1 AND environment <> 'staging'`,
        [instanceId],
      )).rows.map((row) => InstanceEnvironmentStateSchema.parse({
        instanceId, environment: row.environment, state: row.state, updatedAt: iso(row.updated_at),
      }));
      const state = rollupState([...otherEnvironments, { instanceId, environment: 'staging', state: input.state, updatedAt: input.observedAt }]);
      const instance = admit(InstanceSchema, {
        id: instanceId, teamId: input.teamId, name: input.name, template: input.template, templateRef: input.templateRef,
        state, provider: 'railway', createdAt: existing ? iso(existing.created_at) : now, updatedAt: now,
      }, 'instance');
      if (!instance.accepted) return err({ code: 'conflict', reason: instance.reason });
      const observation = admit(HostedStarterSchema, {
        instanceId, projectId: input.projectId, state: input.state, observedAt: input.observedAt,
        deploymentId: input.state === 'live' ? input.deploymentId : current?.deployment_id,
        origin: input.state === 'live' ? input.origin : current?.origin ?? undefined,
      }, 'hosted starter');
      if (!observation.accepted) return err({ code: 'conflict', reason: observation.reason });
      if (existing) {
        await client.query(
          `UPDATE ${this.q('instances')} SET state = $2, updated_at = $3, template_commit = $4 WHERE id = $1`,
          [instanceId, state, now, input.templateRef.commitSha],
        );
      } else {
        await client.query(
          `INSERT INTO ${this.q('instances')} (id, team_id, name, template, template_repo, template_commit, state, provider, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'railway',$8,$8)`,
          [instanceId, input.teamId, input.name, input.template, input.templateRef.repo, input.templateRef.commitSha, state, now],
        );
      }
      await client.query(
        `INSERT INTO ${this.q('hosted_starters')} (instance_id, project_id, deployment_id, origin, state, observed_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (instance_id) DO UPDATE SET project_id = EXCLUDED.project_id, deployment_id = EXCLUDED.deployment_id,
           origin = EXCLUDED.origin, state = EXCLUDED.state, observed_at = EXCLUDED.observed_at`,
        [instanceId, input.projectId, observation.value.deploymentId, observation.value.origin ?? null, input.state, input.observedAt],
      );
      await client.query(
        `INSERT INTO ${this.q('instance_environments')} (instance_id, environment, state, updated_at)
         VALUES ($1,'staging',$2,$3)
         ON CONFLICT (instance_id, environment) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
        [instanceId, input.state, input.observedAt],
      );
      const audit = await this.appendAuditRecord(client, {
        actorKind: 'controller', actorRef: 'private-launch-worker', action: input.state === 'live' ? 'hosting.verified' : `hosting.${input.state}`,
        target: instanceId, at: input.observedAt, detail: { environment: 'staging', deploymentId: observation.value.deploymentId },
      });
      if (!audit.ok) return audit;
      await client.query('COMMIT');
      committed = true;
      return ok(instance.value);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return err({ code: 'conflict', reason: 'An instance already manages this project or name' });
      throw error;
    } finally {
      try { if (!committed) await client.query('ROLLBACK'); }
      finally { client.release(); }
    }
  }

  async getHostedStarter(instanceId: string): Promise<StoreResult<HostedStarter>> {
    const row = (await this.pool.query(`SELECT * FROM ${this.q('hosted_starters')} WHERE instance_id = $1`, [instanceId])).rows[0] as Row | undefined;
    if (!row) return err({ code: 'not-found', what: 'hosted starter', id: instanceId });
    const parsed = admit(HostedStarterSchema, {
      instanceId, projectId: row.project_id, deploymentId: row.deployment_id, origin: row.origin ?? undefined, state: row.state, observedAt: iso(row.observed_at),
    }, 'hosted starter row');
    return parsed.accepted ? ok(parsed.value) : err({ code: 'conflict', reason: parsed.reason });
  }

  async recordHostedAppCheck(input: Parameters<Store['recordHostedAppCheck']>[0]): Promise<void> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      // Use the same lock order as starter registration when a restore overlaps a health check.
      await client.query(`SELECT id FROM ${this.q('instances')} WHERE id = $1 FOR UPDATE`, [input.instanceId]);
      const [hosting] = (await client.query(`SELECT deployment_id, state FROM ${this.q('hosted_starters')} WHERE instance_id = $1`, [input.instanceId])).rows;
      if (hosting?.state !== 'live' || hosting.deployment_id !== input.deploymentId) return;
      const [row] = (await client.query(`SELECT * FROM ${this.q('hosted_app_checks')} WHERE instance_id = $1`, [input.instanceId])).rows;
      const next = nextAppCheck(this.asHostedAppCheck(row), input);
      if (!next) return;
      const { check, changed } = next;
      await client.query(
        `INSERT INTO ${this.q('hosted_app_checks')} (instance_id, deployment_id, state, failures, checked_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (instance_id) DO UPDATE SET deployment_id = EXCLUDED.deployment_id,
           state = EXCLUDED.state, failures = EXCLUDED.failures, checked_at = EXCLUDED.checked_at`,
        [check.instanceId, check.deploymentId, check.state, check.failures, check.checkedAt],
      );
      if (changed) {
        const audit = await this.appendAuditRecord(client, {
          actorKind: 'controller', actorRef: 'private-app-check', action: `availability.${changed}`,
          target: input.instanceId, at: check.checkedAt, detail: { environment: 'staging' },
        });
        if (!audit.ok) throw new Error('Could not record the verified app availability transition');
      }
      await client.query('COMMIT');
      committed = true;
    } finally {
      try { if (!committed) await client.query('ROLLBACK'); }
      finally { client.release(); }
    }
  }

  async getHostedAppCheck(instanceId: string): Promise<HostedAppCheck | undefined> {
    const [row] = (await this.pool.query(`SELECT * FROM ${this.q('hosted_app_checks')} WHERE instance_id = $1`, [instanceId])).rows;
    return this.asHostedAppCheck(row);
  }

  private asHostedAppCheck(row: Row | undefined): HostedAppCheck | undefined {
    if (!row || (row.state !== 'checking' && row.state !== 'up' && row.state !== 'down')) return;
    return {
      instanceId: String(row.instance_id), deploymentId: String(row.deployment_id), state: row.state,
      failures: Number(row.failures), checkedAt: iso(row.checked_at),
    };
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

  publishCapability(offer: NewCapabilityOffer) { return this.saveCapabilityOffer(offer, false); }
  ensureCapabilityOffer(offer: NewCapabilityOffer) { return this.saveCapabilityOffer(offer, true); }

  private async saveCapabilityOffer(offer: NewCapabilityOffer, preserve: boolean) {
    const admitted = admit(CapabilityOfferSchema, { ...offer, publishedAt: offer.publishedAt ?? new Date().toISOString() }, 'capability offer');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const o = admitted.value;
    try {
      const conflict = preserve ? 'DO NOTHING' : 'DO UPDATE SET outputs = EXCLUDED.outputs, published_at = now()';
      const saved = await this.pool.query(
        `INSERT INTO ${this.q('capability_offers')} (instance_id, capability, team_id, outputs, published_at)
         VALUES ($1,$2,$3,$4::jsonb,$5)
         ON CONFLICT (instance_id, capability) ${conflict}`,
        [o.instanceId, o.capability, o.teamId, JSON.stringify(o.outputs), o.publishedAt]);
      if (saved.rowCount === 0) return await this.getCapabilityOffer(o.instanceId, o.capability);
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

  bindCapability(binding: NewBinding) { return this.saveCapabilityBinding(binding, false); }
  ensureCapabilityBinding(binding: NewBinding) { return this.saveCapabilityBinding(binding, true); }

  private async saveCapabilityBinding(binding: NewBinding, preserve: boolean) {
    const admitted = admit(BindingRecordSchema, { ...binding, boundAt: binding.boundAt ?? new Date().toISOString() }, 'binding');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const b = admitted.value;
    try {
      const conflict = preserve ? 'DO NOTHING' : `DO UPDATE SET provider_instance_id = EXCLUDED.provider_instance_id,
        destinations = EXCLUDED.destinations, state = EXCLUDED.state, bound_at = now(), bound_by = EXCLUDED.bound_by`;
      const saved = await this.pool.query(
        `INSERT INTO ${this.q('capability_bindings')} (consumer_instance_id, capability, provider_instance_id, destinations, state, bound_at, bound_by)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
         ON CONFLICT (consumer_instance_id, capability) ${conflict}`,
        [b.consumerInstanceId, b.capability, b.providerInstanceId, JSON.stringify(b.destinations), b.state, b.boundAt, b.boundBy]);
      if (saved.rowCount === 0) return await this.getBinding(b.consumerInstanceId, b.capability);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23503' && (error as { table?: string }).table === 'identity_client_reservations') {
        return err({ code: 'conflict', reason: 'Revoke the identity client before replacing this binding.' });
      }
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
    let removed;
    try {
      removed = await this.pool.query(`DELETE FROM ${this.q('capability_bindings')} WHERE consumer_instance_id = $1 AND capability = $2`, [consumerInstanceId, capability]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503' && capability === 'identity') {
        return err({ code: 'conflict', reason: 'Revoke the identity client before removing this binding.' });
      }
      throw error;
    }
    if ((removed.rowCount ?? 0) === 0) return err({ code: 'not-found', what: 'binding', id: `${consumerInstanceId}/${capability}` });
    return ok({ removed: true });
  }

  async reserveIdentityClient(input: IdentityClientTarget) {
    const target = IdentityClientTargetSchema.parse(input);
    const { consumerInstanceId, providerInstanceId, boundAt, environment, teamId } = target;
    try {
      const result = await this.pool.query(`INSERT INTO ${this.q('identity_client_reservations')}
        (consumer_instance_id, provider_instance_id, bound_at, environment, target)
        SELECT b.consumer_instance_id, b.provider_instance_id, b.bound_at, $4, $6::jsonb
        FROM ${this.q('capability_bindings')} b
        JOIN ${this.q('instances')} consumer ON consumer.id = b.consumer_instance_id
        JOIN ${this.q('instances')} provider ON provider.id = b.provider_instance_id
        WHERE b.consumer_instance_id = $1 AND b.provider_instance_id = $2 AND b.capability = 'identity'
          AND date_trunc('milliseconds', b.bound_at) = $3::timestamptz AND b.state = 'bound'
          AND consumer.team_id = $5 AND provider.team_id = $5
          AND consumer.state NOT IN ('deprovisioning', 'removed') AND provider.state NOT IN ('deprovisioning', 'removed')
        ON CONFLICT (consumer_instance_id, environment) DO NOTHING RETURNING target`,
      [consumerInstanceId, providerInstanceId, boundAt, environment, teamId, JSON.stringify(target)]);
      return result.rows.length ? target : await this.getIdentityClient(consumerInstanceId, environment);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return undefined;
      throw error;
    }
  }

  async getIdentityClient(consumerInstanceId: string, environment: IdentityClientTarget['environment']) {
    const result = await this.pool.query(`SELECT target FROM ${this.q('identity_client_reservations')}
      WHERE consumer_instance_id = $1 AND environment = $2`, [consumerInstanceId, environment]);
    const row = result.rows[0];
    return row ? IdentityClientTargetSchema.parse(row.target) : undefined;
  }

  async releaseIdentityClient(input: IdentityClientTarget) {
    const target = IdentityClientTargetSchema.parse(input);
    await this.pool.query(`DELETE FROM ${this.q('identity_client_reservations')}
      WHERE consumer_instance_id = $1 AND environment = $2 AND target = $3::jsonb`,
    [target.consumerInstanceId, target.environment, JSON.stringify(target)]);
  }

  async resolvePerson(input: { issuer: string; subject: string; kind?: Person['kind']; label?: string }) {
    const existing = await this.getPersonByIdentity(input.issuer, input.subject);
    if (existing.ok) return ok({ person: existing.value, created: false });
    const id = newId('person');
    const client = await this.pool.connect();
    let linked: StoreResult<Identity>;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO ${this.q('persons')} (id, kind, label) VALUES ($1,$2,$3)`, [id, input.kind ?? 'human', input.label ?? null]);
      linked = await this.writeIdentity({ personId: id, issuer: input.issuer, subject: input.subject }, client);
      await client.query(linked.ok ? 'COMMIT' : 'ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    if (!linked.ok) {
      // A concurrent first sign-in may have linked the proof while this transaction was opening.
      const winner = await this.getPersonByIdentity(input.issuer, input.subject);
      return winner.ok ? ok({ person: winner.value, created: false }) : err({ code: 'conflict', reason: `identity link refused: ${reasonOf(linked)}` });
    }
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
    return this.writeIdentity(input, this.pool);
  }

  private async writeIdentity(input: { personId: string; issuer: string; subject: string }, db: Pick<Pool, 'query'>) {
    const admitted = admit(IdentitySchema, { ...input, verifiedAt: new Date().toISOString() }, 'identity');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const i = admitted.value;
    try {
      const { rows } = await db.query(
        `INSERT INTO ${this.q('identities')} AS stored (issuer, subject, person_id, verified_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (issuer, subject) DO UPDATE SET verified_at = EXCLUDED.verified_at
         WHERE stored.person_id = EXCLUDED.person_id RETURNING verified_at`,
        [i.issuer, i.subject, i.personId, i.verifiedAt],
      );
      return rows[0] ? ok({ ...i, verifiedAt: iso(rows[0].verified_at) }) : err({ code: 'conflict', reason: 'identity already linked' });
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'person', id: i.personId });
      throw error;
    }
  }

  async unlinkIdentity(issuer: string, subject: string) {
    return this.removeIdentity(issuer, subject);
  }

  async unlinkOwnedIdentity(issuer: string, subject: string, personId: string) {
    return this.removeIdentity(issuer, subject, personId);
  }

  private async removeIdentity(issuer: string, subject: string, expectedPersonId?: string) {
    const removed = await this.pool.query(
      `DELETE FROM ${this.q('identities')} WHERE issuer = $1 AND subject = $2 AND ($3::text IS NULL OR person_id = $3)`,
      [issuer, subject, expectedPersonId ?? null]);
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

  async getHubSignIn(teamId: string) {
    const { rows } = await this.pool.query<{ issuer: string; client_id: string }>(
      `SELECT issuer, client_id FROM ${this.q('hub_sign_in')} WHERE team_id = $1`, [teamId]);
    const row = rows[0];
    return row && { issuer: row.issuer, clientId: row.client_id };
  }

  async setHubSignIn(teamId: string, trust: HubSignInTrust | undefined) {
    if (!trust) {
      await this.pool.query(`DELETE FROM ${this.q('hub_sign_in')} WHERE team_id = $1`, [teamId]);
      return;
    }
    await this.pool.query(
      `INSERT INTO ${this.q('hub_sign_in')} (team_id, issuer, client_id) VALUES ($1,$2,$3)
       ON CONFLICT (team_id) DO UPDATE SET issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id`,
      [teamId, trust.issuer, trust.clientId]);
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
        `INSERT INTO ${this.q('team_members')} AS membership (team_id, person_id, role, added_at)
         VALUES ($1,$2,$3,now())
         ON CONFLICT (team_id, person_id) DO UPDATE SET role = membership.role
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


  async changeTeamMember(teamId: string, actorId: string, personId: string, role: TeamRole | null): Promise<StoreResult<TeamMember>> {
    const client = await this.pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      await client.query(`SELECT id FROM ${this.q('teams')} WHERE id = $1 FOR UPDATE`, [teamId]);
      const owner = await client.query(
        `SELECT 1 FROM ${this.q('team_members')} WHERE team_id = $1 AND person_id = $2 AND role = 'owner'`, [teamId, actorId],
      );
      if (!owner.rowCount) return err({ code: 'not-found', what: 'ownership', id: teamId });
      if (actorId === personId) return err({ code: 'conflict', reason: 'Another owner must change your membership' });
      const result = role === null
        ? await client.query(`DELETE FROM ${this.q('team_members')} WHERE team_id = $1 AND person_id = $2 RETURNING *`, [teamId, personId])
        : await client.query(`UPDATE ${this.q('team_members')} SET role = $3 WHERE team_id = $1 AND person_id = $2 RETURNING *`, [teamId, personId, role]);
      const row = result.rows[0];
      if (!row) return err({ code: 'not-found', what: 'team membership', id: personId });
      const member = TeamMemberSchema.parse({ teamId, personId, role: row.role, addedAt: iso(row.added_at) });
      await client.query('COMMIT');
      committed = true;
      return ok(member);
    } finally {
      try { if (!committed) await client.query('ROLLBACK'); }
      finally { client.release(); }
    }
  }

  async teamsForPerson(personId: string) {
    const rows = (await this.pool.query(`SELECT team_id FROM ${this.q('team_members')} WHERE person_id = $1 ORDER BY added_at ASC`, [personId])).rows as Row[];
    return rows.map((r) => String(r.team_id));
  }

  async putPlan(instanceId: string, plan: unknown, planHash: string) {
    if (!plan || typeof plan !== 'object') return err({ code: 'conflict', reason: 'plan must be an object' });
    if (!/^[0-9a-f]{64}$/.test(planHash)) return err({ code: 'conflict', reason: `plan hash is not a bare 64-hex digest: ${planHash.slice(0, 24)}` });
    try {
      const result = await this.pool.query(
        `INSERT INTO ${this.q('plans')} (instance_id, plan_hash, plan, registered_at)
         SELECT id,$2,$3::jsonb,now() FROM ${this.q('instances')}
         WHERE id = $1 AND (marketplace_receipt IS NULL OR marketplace_receipt->>'variant' = 'starter-template')
         ON CONFLICT (instance_id) DO UPDATE SET plan_hash = EXCLUDED.plan_hash, plan = EXCLUDED.plan, registered_at = now()`,
        [instanceId, planHash, JSON.stringify(plan)]);
      if (!result.rowCount) {
        return (await this.getInstance(instanceId)).ok
          ? err({ code: 'conflict', reason: 'The verified marketplace image plan is immutable' })
          : err({ code: 'not-found', what: 'instance', id: instanceId });
      }
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'instance', id: instanceId });
      throw error;
    }
    return ok({ instanceId, planHash });
  }

  async putArtifact(artifact: Omit<ArtifactRecord, 'reportedAt'> & { reportedAt?: string }) {
    const parsed = ArtifactRecordSchema.safeParse({ ...artifact, reportedAt: artifact.reportedAt ?? new Date().toISOString() });
    if (!parsed.success) {
      // Schema-level refusal with the field named, because a digest that is not `sha256:<64 hex>` is the exact
      // class of mistake #84 was written about -- better caught at the door than at the provider.
      // z.prettifyError rather than hand-walking `issues`: the union has variants whose `path` shape differs,
      // and hand-rolling that traversal bought a type error where a one-line helper was already correct.
      return err({ code: 'conflict', reason: `artifact is not well-formed: ${z.prettifyError(parsed.error)}` });
    }
    try {
      await this.pool.query(
        `INSERT INTO ${this.q('release_artifacts')} (instance_id, service, image, digest, source_ref, version, reported_at, reported_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (instance_id, service) DO UPDATE
           SET image = EXCLUDED.image, digest = EXCLUDED.digest, source_ref = EXCLUDED.source_ref,
               version = EXCLUDED.version, reported_at = EXCLUDED.reported_at, reported_by = EXCLUDED.reported_by`,
        [parsed.data.instanceId, parsed.data.service, parsed.data.image, parsed.data.digest,
          parsed.data.sourceRef ?? null, parsed.data.version ?? null, parsed.data.reportedAt, parsed.data.reportedBy]);
    } catch (error) {
      if ((error as { code?: string }).code === '23503') return err({ code: 'not-found', what: 'instance', id: artifact.instanceId });
      throw error;
    }
    return ok(parsed.data);
  }

  async listArtifacts(instanceId: string): Promise<ArtifactRecord[]> {
    const rows = await this.pool.query(
      `SELECT instance_id, service, image, digest, source_ref, version, reported_at, reported_by
         FROM ${this.q('release_artifacts')} WHERE instance_id = $1 ORDER BY reported_at DESC`, [instanceId]);
    return (rows.rows as Record<string, unknown>[]).map((r) => ({
      instanceId: String(r.instance_id), service: String(r.service), image: String(r.image), digest: String(r.digest),
      ...(r.source_ref === null || r.source_ref === undefined ? {} : { sourceRef: String(r.source_ref) }),
      ...(r.version === null || r.version === undefined ? {} : { version: String(r.version) }),
      reportedAt: r.reported_at instanceof Date ? r.reported_at.toISOString() : String(r.reported_at),
      reportedBy: String(r.reported_by),
    }));
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
    return this.readAttestations(instanceId, limit);
  }

  async listEnvironmentAttestations(instanceId: string, environment: string, limit = 50) {
    return this.readAttestations(instanceId, limit, environment);
  }

  private async readAttestations(instanceId: string, limit: number, environment?: string): Promise<AttestationRecord[]> {
    const rows = (await this.pool.query(
      `SELECT * FROM ${this.q('attestations')} WHERE instance_id = $1 AND ($3::text IS NULL OR environment = $3)
       ORDER BY finished_at DESC, received_at DESC, dispatch_id DESC LIMIT $2`, [instanceId, limit, environment ?? null],
    )).rows as Row[];
    return values(rows.map((r) => this.asAttestation(r)));
  }

  async appendAudit(entry: Omit<AuditEntry, 'id' | 'at'> & { at?: string }) {
    return this.appendAuditRecord(this.pool, entry);
  }

  private async appendAuditRecord(client: Pool | PoolClient, entry: Omit<AuditEntry, 'id' | 'at'> & { at?: string }) {
    const admitted = admit(AuditEntrySchema, { ...entry, id: newId('aud'), at: entry.at ?? new Date().toISOString() }, 'audit entry');
    if (!admitted.accepted) return err({ code: 'conflict', reason: admitted.reason });
    const e = admitted.value;
    await client.query(
      `INSERT INTO ${this.q('audit_log')} (id, at, actor_kind, actor_ref, action, target, detail) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [e.id, e.at, e.actorKind, e.actorRef, e.action, e.target, JSON.stringify(e.detail)]);
    return ok(e);
  }

  /** Ordered by the insertion counter, not by `at`: three rows sharing one statement timestamp made `at DESC` a coin flip, which CI caught and my laptop did not. */
  async recentAudit(limit = 50) {
    return this.readAudit(limit);
  }

  async recentAuditForTargets(targets: readonly string[], limit: number) {
    return this.readAudit(limit, targets);
  }

  private async readAudit(limit: number, targets?: readonly string[]) {
    const rows = (await this.pool.query(
      `SELECT * FROM ${this.q('audit_log')} WHERE ($2::text[] IS NULL OR target = ANY($2)) ORDER BY seq DESC LIMIT $1`,
      [limit, targets ?? null],
    )).rows as Row[];
    return rows.map((r) => {
      const admitted = admit(AuditEntrySchema, { id: r.id, at: iso(r.at), actorKind: r.actor_kind, actorRef: r.actor_ref, action: r.action, target: r.target, detail: r.detail }, 'audit row');
      return admitted.accepted ? admitted.value : undefined;
    }).filter((x): x is AuditEntry => x !== undefined);
  }

  async saveNotificationRule(personId: string, input: NewNotificationRule): Promise<StoreResult<NotificationRule>> {
    const candidate = admit(NotificationRuleSchema, {
      ...input, id: input.id ?? newId('rule'), createdAt: new Date().toISOString(),
    }, 'notification rule');
    if (!candidate.accepted) return err({ code: 'conflict', reason: candidate.reason });
    const { id, instanceId, event, enabled, environment } = candidate.value;
    const allowed = `SELECT 1 FROM ${this.q('instances')} AS app
      JOIN ${this.q('team_members')} AS member ON member.team_id = app.team_id AND member.person_id = $2
      WHERE app.id = $3 AND ($4::text IS NULL OR EXISTS (
        SELECT 1 FROM ${this.q('instance_environments')} WHERE instance_id = app.id AND environment = $4
      ))`;
    try {
      const values = [id, personId, instanceId, environment ?? null, event, enabled];
      const result = input.id
        ? await this.pool.query(
          `UPDATE ${this.q('notification_rules')} SET environment = $4, event = $5, enabled = $6, active_since = now()
           WHERE id = $1 AND person_id = $2 AND instance_id = $3 AND EXISTS (${allowed}) RETURNING *`, values,
        )
        : await this.pool.query(
          `INSERT INTO ${this.q('notification_rules')} (id, person_id, instance_id, environment, event, enabled)
           SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (${allowed}) RETURNING *`, values,
        );
      const row = result.rows[0];
      return row ? this.asNotificationRule(row) : err({ code: 'not-found', what: 'app, environment, or notification rule', id: input.id ?? instanceId });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return err({ code: 'conflict', reason: 'This event already has a rule for that environment' });
      throw error;
    }
  }

  async listNotificationRules(personId: string): Promise<NotificationRule[]> {
    const result = await this.pool.query(
      `SELECT rule.* FROM ${this.q('notification_rules')} AS rule
       JOIN ${this.q('instances')} AS app ON app.id = rule.instance_id
       JOIN ${this.q('team_members')} AS member ON member.team_id = app.team_id AND member.person_id = rule.person_id
       WHERE rule.person_id = $1 ORDER BY rule.created_at, rule.id`, [personId],
    );
    return values(result.rows.map((row) => this.asNotificationRule(row)));
  }

  async removeNotificationRule(personId: string, instanceId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM ${this.q('notification_rules')} WHERE id = $1 AND person_id = $2 AND instance_id = $3`, [id, personId, instanceId],
    );
    return result.rowCount === 1;
  }

  async getNotificationEmailPreference(personId: string): Promise<NotificationEmailPreference | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.q('notification_email_preferences')} WHERE person_id = $1`, [personId],
    );
    const row = rows[0];
    if (row) return { personId, issuer: String(row.issuer), subject: String(row.subject), enabledAt: iso(row.enabled_at) };
  }

  async setNotificationEmailPreference(personId: string, preference: Omit<NotificationEmailPreference, 'personId'> | null) {
    if (!preference) {
      await this.pool.query(`DELETE FROM ${this.q('notification_email_preferences')} WHERE person_id = $1`, [personId]);
      return true;
    }
    const result = await this.pool.query(
      `INSERT INTO ${this.q('notification_email_preferences')} AS previous (person_id, issuer, subject, enabled_at)
       SELECT person_id, issuer, subject, $4::timestamptz FROM ${this.q('identities')}
       WHERE person_id = $1 AND issuer = $2 AND subject = $3
       ON CONFLICT (person_id) DO UPDATE SET issuer = excluded.issuer, subject = excluded.subject, enabled_at =
         CASE WHEN previous.issuer = excluded.issuer AND previous.subject = excluded.subject
         THEN previous.enabled_at ELSE excluded.enabled_at END`,
      [personId, preference.issuer, preference.subject, preference.enabledAt],
    );
    return result.rowCount === 1;
  }

  async leaseNotificationEmails(issuer: string, now: string): Promise<NotificationEmailDelivery[]> {
    const leaseId = newId('lease');
    const { rows } = await this.pool.query(
      `WITH matches AS (
         SELECT DISTINCT ON (audit.seq, preference.person_id)
           audit.id AS audit_id, audit.at, audit.detail->>'environment' AS environment,
           preference.person_id, preference.subject, preference.enabled_at,
           app.id AS instance_id, app.team_id, rule.event
         FROM ${this.q('notification_email_preferences')} AS preference
         JOIN ${this.q('notification_rules')} AS rule ON rule.person_id = preference.person_id AND rule.enabled
         JOIN ${this.q('instances')} AS app ON app.id = rule.instance_id
         JOIN ${this.q('team_members')} AS member ON member.team_id = app.team_id AND member.person_id = preference.person_id
         JOIN ${this.q('audit_log')} AS audit ON audit.target = app.id
         JOIN jsonb_to_recordset($4::jsonb) AS event(action text, event text, result text)
           ON event.action = audit.action AND event.event = rule.event
           AND (event.result IS NULL OR event.result = audit.detail->>'result')
         LEFT JOIN ${this.q('notification_email_deliveries')} AS delivery
           ON delivery.person_id = preference.person_id AND delivery.audit_id = audit.id
         WHERE preference.issuer = $1
           AND (rule.environment IS NULL OR rule.environment = audit.detail->>'environment')
           AND audit.at BETWEEN GREATEST(preference.enabled_at, rule.active_since, member.added_at, $2::timestamptz - interval '24 hours') AND $2
           AND (delivery.attempts IS NULL OR (delivery.attempts < 4 AND delivery.due_at <= $2))
         ORDER BY audit.seq, preference.person_id
         LIMIT 5
       ), leased AS (
         INSERT INTO ${this.q('notification_email_deliveries')} AS previous (person_id, audit_id, lease_id, attempts, due_at)
         SELECT person_id, audit_id, $3, 1, $2::timestamptz + interval '3 minutes' FROM matches
         ON CONFLICT (person_id, audit_id) DO UPDATE SET lease_id = excluded.lease_id,
           attempts = previous.attempts + 1, due_at = excluded.due_at
         WHERE previous.due_at <= $2 AND previous.attempts < 4
         RETURNING person_id, audit_id, attempts
       )
       SELECT matches.*, leased.attempts FROM matches JOIN leased USING (person_id, audit_id)`,
      [issuer, now, leaseId, JSON.stringify(notificationEvents)],
    );
    return rows.map((row) => ({
      auditId: String(row.audit_id), leaseId, attempts: Number(row.attempts),
      preference: { personId: String(row.person_id), issuer, subject: String(row.subject), enabledAt: iso(row.enabled_at) },
      instanceId: String(row.instance_id), teamId: String(row.team_id),
      event: row.event as NotificationRule['event'], at: iso(row.at),
      ...(typeof row.environment === 'string' ? { environment: row.environment } : {}),
    }));
  }

  async settleNotificationEmail(delivery: Pick<NotificationEmailDelivery, 'auditId' | 'leaseId' | 'preference'>, retryAt: string | null) {
    await this.pool.query(
      `UPDATE ${this.q('notification_email_deliveries')} SET due_at = $4
       WHERE person_id = $1 AND audit_id = $2 AND lease_id = $3`,
      [delivery.preference.personId, delivery.auditId, delivery.leaseId, retryAt],
    );
  }

  private asNotificationRule(row: Row): StoreResult<NotificationRule> {
    const rule = admit(NotificationRuleSchema, {
      id: row.id, instanceId: row.instance_id, event: row.event, enabled: row.enabled, createdAt: iso(row.created_at),
      ...(row.environment === null ? {} : { environment: row.environment }),
    }, 'notification rule row');
    return rule.accepted ? ok(rule.value) : err({ code: 'conflict', reason: rule.reason });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ready = false;
    await this.pool.end();
  }
}
