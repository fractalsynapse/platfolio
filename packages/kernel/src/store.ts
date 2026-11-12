import { Context, Service } from 'cordis';
import { MemoryStore, PostgresStore, applyMigrations, safeSchema, type Store, type StoreError, type StoreResult } from '@platfolio/contracts';
import { z } from 'zod';

/**
 * The persistence capability as `ctx.store`.
 *
 * The driver is configuration, not a branch at the call site -- the same property E9 measured for providers and
 * D15 protects by making this package the only place that may import Cordis. `memory` is not a test-only
 * indulgence either: it is what lets the control plane boot, and its conformance against the Postgres suite,
 * without a database.
 *
 * One deliberate non-feature: no `query` escape hatch. A capability that leaks SQL upward cannot be swapped,
 * and the reason to have a seam at all is that it can be.
 */
export const StoreConfigSchema = z.object({
  driver: z.enum(['memory', 'postgres']).default('memory'),
  /** Only for postgres. Read from the environment at the composition root, never embedded in a plan. */
  connectionString: z.string().min(10).optional(),
  schema: z.string().default('platfolio'),
  /** Apply migrations at boot. Off by default: a control plane that migrates on start can race its own replicas. */
  migrate: z.boolean().default(false),
  expectedMigrations: z.array(z.number().int().positive()).default([1]),
}).strict();

export class StoreService extends Service<z.infer<typeof StoreConfigSchema>> {
  static inject = [] as const;
  static provide = 'store' as const;
  static Config = StoreConfigSchema;

  readonly inner: Store;
  readonly config: z.infer<typeof StoreConfigSchema>;

  constructor(ctx: Context, config: z.infer<typeof StoreConfigSchema>) {
    super(ctx, 'store');
    this.config = config;
    if (config.driver === 'postgres') {
      if (!config.connectionString) throw new Error('store driver "postgres" requires a connectionString (PLATFOLIO_DB_URL) -- refusing to fall back to memory, because silently losing records is worse than failing to start');
      this.inner = new PostgresStore({ connectionString: config.connectionString, schema: safeSchema(config.schema), expectedMigrations: config.expectedMigrations });
    } else {
      this.inner = new MemoryStore();
    }
  }

  /** Migration is explicit and separate from construction; boot order belongs to the composition root. */
  async migrate(): Promise<{ applied: number[]; at: number[] }> {
    if (this.config.driver !== 'postgres' || !this.config.connectionString) return { applied: [], at: [] };
    const result = await applyMigrations({ connectionString: this.config.connectionString, schema: safeSchema(this.config.schema) });
    return { applied: result.applied.map((a) => a.version), at: result.at };
  }

  ping(): Promise<boolean> {
    return this.inner.ping();
  }

  describe() {
    return this.inner.describe();
  }

  // Pass-through surface. Kept as methods rather than exposing the inner store so the capability can add
  // instrumentation (timing, audit) later without every call site changing.
  createTeam(input: { name: string }) { return this.inner.createTeam(input); }
  getTeam(id: string) { return this.inner.getTeam(id); }
  listTeams() { return this.inner.listTeams(); }
  // Parameters and returns come from the interface itself. Hand-copying a union here is how a new state
  // ('degraded', added to the schema the same day) silently fails to reach the facade.
  createInstance(input: Parameters<Store['createInstance']>[0]) { return this.inner.createInstance(input); }
  getInstance(id: string) { return this.inner.getInstance(id); }
  listInstances(teamId?: string) { return this.inner.listInstances(teamId); }
  updateInstanceState(...args: Parameters<Store['updateInstanceState']>) { return this.inner.updateInstanceState(...args); }
  putRepoConnection(conn: Parameters<Store['putRepoConnection']>[0]) { return this.inner.putRepoConnection(conn); }
  getRepoConnection(instanceId: string) { return this.inner.getRepoConnection(instanceId); }
  putProviderConnection(conn: Parameters<Store['putProviderConnection']>[0]) { return this.inner.putProviderConnection(conn); }
  getProviderConnection(instanceId: string) { return this.inner.getProviderConnection(instanceId); }
  putTeamMember(...args: Parameters<Store['putTeamMember']>) { return this.inner.putTeamMember(...args); }
  getTeamMember(...args: Parameters<Store['getTeamMember']>) { return this.inner.getTeamMember(...args); }
  listTeamMembers(...args: Parameters<Store['listTeamMembers']>) { return this.inner.listTeamMembers(...args); }
  teamsForPerson(...args: Parameters<Store['teamsForPerson']>) { return this.inner.teamsForPerson(...args); }
  resolvePerson(...args: Parameters<Store['resolvePerson']>) { return this.inner.resolvePerson(...args); }
  getPerson(...args: Parameters<Store['getPerson']>) { return this.inner.getPerson(...args); }
  listPersons() { return this.inner.listPersons(); }
  linkIdentity(...args: Parameters<Store['linkIdentity']>) { return this.inner.linkIdentity(...args); }
  unlinkIdentity(...args: Parameters<Store['unlinkIdentity']>) { return this.inner.unlinkIdentity(...args); }
  listIdentities(...args: Parameters<Store['listIdentities']>) { return this.inner.listIdentities(...args); }
  getPersonByIdentity(...args: Parameters<Store['getPersonByIdentity']>) { return this.inner.getPersonByIdentity(...args); }
  publishCapability(...args: Parameters<Store['publishCapability']>) { return this.inner.publishCapability(...args); }
  getCapabilityOffer(...args: Parameters<Store['getCapabilityOffer']>) { return this.inner.getCapabilityOffer(...args); }
  listCapabilityOffers(...args: Parameters<Store['listCapabilityOffers']>) { return this.inner.listCapabilityOffers(...args); }
  shareCapability(...args: Parameters<Store['shareCapability']>) { return this.inner.shareCapability(...args); }
  revokeCapabilityShare(...args: Parameters<Store['revokeCapabilityShare']>) { return this.inner.revokeCapabilityShare(...args); }
  listCapabilityShares(...args: Parameters<Store['listCapabilityShares']>) { return this.inner.listCapabilityShares(...args); }
  availableOffersForTeam(...args: Parameters<Store['availableOffersForTeam']>) { return this.inner.availableOffersForTeam(...args); }
  bindCapability(...args: Parameters<Store['bindCapability']>) { return this.inner.bindCapability(...args); }
  getBinding(...args: Parameters<Store['getBinding']>) { return this.inner.getBinding(...args); }
  listBindings(...args: Parameters<Store['listBindings']>) { return this.inner.listBindings(...args); }
  listConsumers(...args: Parameters<Store['listConsumers']>) { return this.inner.listConsumers(...args); }
  unbindCapability(...args: Parameters<Store['unbindCapability']>) { return this.inner.unbindCapability(...args); }
  createInvitation(...args: Parameters<Store['createInvitation']>) { return this.inner.createInvitation(...args); }
  getInvitation(...args: Parameters<Store['getInvitation']>) { return this.inner.getInvitation(...args); }
  listInvitations(...args: Parameters<Store['listInvitations']>) { return this.inner.listInvitations(...args); }
  findInvitationsForEmail(...args: Parameters<Store['findInvitationsForEmail']>) { return this.inner.findInvitationsForEmail(...args); }
  acceptInvitation(...args: Parameters<Store['acceptInvitation']>) { return this.inner.acceptInvitation(...args); }
  revokeInvitation(...args: Parameters<Store['revokeInvitation']>) { return this.inner.revokeInvitation(...args); }
  setInvitationEmailResult(...args: Parameters<Store['setInvitationEmailResult']>) { return this.inner.setInvitationEmailResult(...args); }

  setInstanceEnvironment(...args: Parameters<Store['setInstanceEnvironment']>) { return this.inner.setInstanceEnvironment(...args); }
  getInstanceEnvironment(...args: Parameters<Store['getInstanceEnvironment']>) { return this.inner.getInstanceEnvironment(...args); }
  listInstanceEnvironments(...args: Parameters<Store['listInstanceEnvironments']>) { return this.inner.listInstanceEnvironments(...args); }
  putPlan(instanceId: string, plan: unknown, planHash: string) { return this.inner.putPlan(instanceId, plan, planHash); }
  getPlan(instanceId: string) { return this.inner.getPlan(instanceId); }
  createDispatch(input: Parameters<Store['createDispatch']>[0]) { return this.inner.createDispatch(input); }
  getDispatch(id: string) { return this.inner.getDispatch(id); }
  consumeDispatch(id: string) { return this.inner.consumeDispatch(id); }
  listDispatches(instanceId: string, limit?: number) { return this.inner.listDispatches(instanceId, limit); }
  recordAttestation(attestation: Parameters<Store['recordAttestation']>[0], receivedAt?: string, actor?: { kind?: 'runner' | 'operator' | 'shared-secret'; ref?: string }) { return this.inner.recordAttestation(attestation, receivedAt, actor); }
  getAttestation(dispatchId: string) { return this.inner.getAttestation(dispatchId); }
  latestAttestation(instanceId: string) { return this.inner.latestAttestation(instanceId); }
  listAttestations(instanceId: string, limit?: number) { return this.inner.listAttestations(instanceId, limit); }
  appendAudit(entry: Parameters<Store['appendAudit']>[0]) { return this.inner.appendAudit(entry); }
  recentAudit(limit?: number) { return this.inner.recentAudit(limit); }
  close() { return this.inner.close(); }

  /** Errors are values, but a store that cannot be reached is a condition worth logging where it happens. */
  static noteFailure(error: StoreError): string {
    return error.code === 'not-found' ? `${error.what} ${error.id} not found` : error.reason;
  }
}

export type { StoreResult };

declare module 'cordis' {
  interface Context {
    store: StoreService;
  }
}
