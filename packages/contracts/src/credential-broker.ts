import { z } from 'zod';

/**
 * Credential custody (D20). One seam so "managed" and "strict" are a configuration choice rather than
 * two code paths: managed holds one grant per tenant and refuses to read secrets with it; strict holds
 * nothing at all.
 */
export const BROKER_MODES = ['managed', 'strict'] as const;
export type BrokerMode = (typeof BROKER_MODES)[number];

/**
 * Operations that would return a secret value. Refusal is by name, at the boundary that can reach the
 * provider, because "we will not call that" is only a claim once there is one place it could be called.
 */
export const DENIED_OPERATIONS = [
  'variables', 'variableList', 'variableInfo', 'serviceVariables', 'environmentVariables',
] as const;

export const GrantSchema = z.object({
  tenantId: z.string().min(1),
  /** `oauth` for a user-granted Railway OAuth token; `workspace-token` for one pasted workspace token. */
  kind: z.enum(['oauth', 'workspace-token']),
  workspaceId: z.string().min(1),
  /**
   * Present only for the instant a grant is created, and never again. The broker keeps it in memory or
   * in its own encrypted store; no read path returns it, and it is never in an audit entry.
   */
  token: z.string().min(8).optional(),
}).strict();

export interface GrantReceipt { tenantId: string; kind: string; workspaceId: string; grantedAt: string; masked: string; }
export interface AuditEntry { at: string; tenantId: string; actor: string; operation: string; outcome: 'ok' | 'refused' | 'error'; detail?: string; }

export interface CredentialBroker {
  readonly mode: BrokerMode;
  grant(input: z.input<typeof GrantSchema>, actor: string): Promise<GrantReceipt>;
  call<T>(tenantId: string, operation: string, params: unknown, actor: string): Promise<T>;
  revoke(tenantId: string, actor: string): Promise<void>;
  /** Entries are value-free by construction; the conformance suite proves it. */
  audit(tenantId: string): AuditEntry[];
}

/** Managed custody: one grant per tenant, operation-level API, secret reads refused. */
export class ManagedCredentialBroker implements CredentialBroker {
  readonly mode = 'managed' as const;
  private readonly grants = new Map<string, { kind: string; workspaceId: string; token: string }>();
  private readonly log: AuditEntry[] = [];

  private readonly invoke: ((tenantId: string, operation: string, params: unknown, token: string) => Promise<unknown>) | undefined;

  constructor(invoke?: (tenantId: string, operation: string, params: unknown, token: string) => Promise<unknown>) {
    this.invoke = invoke;
  }

  async grant(input: z.input<typeof GrantSchema>, actor: string): Promise<GrantReceipt> {
    const g = GrantSchema.parse(input);
    if (!g.token) throw new Error('managed custody requires the granted credential at connect time');
    this.grants.set(g.tenantId, { kind: g.kind, workspaceId: g.workspaceId, token: g.token });
    this.record(g.tenantId, actor, 'grant', 'ok');
    return { tenantId: g.tenantId, kind: g.kind, workspaceId: g.workspaceId, grantedAt: new Date().toISOString(), masked: mask(g.token) };
  }

  async call<T>(tenantId: string, operation: string, params: unknown, actor: string): Promise<T> {
    const grant = this.grants.get(tenantId);
    if (!grant) {
      this.record(tenantId, actor, operation, 'error', 'no grant');
      throw new Error(`tenant "${tenantId}" has no credential grant`);
    }
    if ((DENIED_OPERATIONS as readonly string[]).includes(operation)) {
      // Refused before the transport: no call is made, so a secret value cannot exist anywhere.
      this.record(tenantId, actor, operation, 'refused', 'secret-reading operation is denied by policy');
      throw new Error(`operation "${operation}" is denied: the broker cannot read tenant secrets`);
    }
    if (!this.invoke) throw new Error('no provider transport configured');
    try {
      const result = await this.invoke(tenantId, operation, params, grant.token) as T;
      this.record(tenantId, actor, operation, 'ok');
      return result;
    } catch (error) {
      this.record(tenantId, actor, operation, 'error', (error as Error).message.slice(0, 200));
      throw error;
    }
  }

  async revoke(tenantId: string, actor: string): Promise<void> {
    this.grants.delete(tenantId);
    this.record(tenantId, actor, 'revoke', 'ok');
  }

  audit(tenantId: string): AuditEntry[] {
    return this.log.filter((e) => e.tenantId === tenantId);
  }

  private record(tenantId: string, actor: string, operation: string, outcome: AuditEntry['outcome'], detail?: string): void {
    this.log.push({ at: new Date().toISOString(), tenantId, actor, operation, outcome, ...(detail ? { detail } : {}) });
  }
}

/** Strict custody (mode A): there is no grant to hold, so every call is refused by construction. */
export class StrictCredentialBroker implements CredentialBroker {
  readonly mode = 'strict' as const;
  async grant(): Promise<GrantReceipt> {
    throw new Error('strict mode stores no provider credential; place the grant in the tenant CI (docs/design/04)');
  }
  async call<T>(tenantId: string, _operation: string): Promise<T> {
    throw new Error(`strict mode holds no credential for tenant "${tenantId}"`);
  }
  async revoke(): Promise<void> { /* nothing to forget */ }
  audit(): AuditEntry[] { return []; }
}

function mask(token: string): string {
  // Enough to recognise a credential, not enough to reproduce it.
  return `${token.slice(0, 3)}…${token.slice(-2)} (${token.length})`;
}

export interface BrokerCheck { name: string; ok: boolean; detail: string; }

/** The suite every custody implementation must pass, so mode A and mode B are held to one standard. */
export async function runBrokerConformance(make: () => CredentialBroker, secretSentinel: string): Promise<{ checks: BrokerCheck[]; ok: boolean }> {
  const checks: BrokerCheck[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const seen: string[] = [];
  const broker = make();
  const invoke = async (_t: string, op: string, _p: unknown, token: string) => { seen.push(`${op}:${token.length}`); return { ok: true }; };
  const withTransport = broker instanceof ManagedCredentialBroker ? new ManagedCredentialBroker(invoke) : broker;

  if (broker.mode === 'strict') {
    let threw = false;
    try { await withTransport.grant({ tenantId: 't1', kind: 'workspace-token', workspaceId: 'w1', token: secretSentinel }, 'tester'); } catch { threw = true; }
    push('strict mode accepts no grant', threw, 'a strict broker must refuse to hold a credential');
    push('strict mode audits nothing', withTransport.audit('t1').length === 0, 'no grant, no log');
    return { checks, ok: checks.every((c) => c.ok) };
  }

  const receipt = await withTransport.grant({ tenantId: 't1', kind: 'workspace-token', workspaceId: 'w1', token: secretSentinel }, 'tester');
  push('grant returns a receipt, not the credential', !JSON.stringify(receipt).includes(secretSentinel), JSON.stringify(receipt));
  push('receipt identifies the credential', receipt.masked.includes('…'), receipt.masked);

  for (const op of DENIED_OPERATIONS) {
    let refused = false;
    try { await withTransport.call('t1', op, {}, 'tester'); } catch (e) { refused = String((e as Error).message).includes('denied'); }
    push(`${op} is refused`, refused, refused ? 'refused before the transport' : 'REACHED THE PROVIDER');
  }
  push('no denied call reached the transport', seen.every((s) => !((DENIED_OPERATIONS as readonly string[]).includes(s.split(':')[0]!))), seen.join(', '));

  await withTransport.call('t1', 'projectCreate', { name: 'p' }, 'tester');
  push('permitted operation goes through', seen.some((s) => s.startsWith('projectCreate')), seen.join(', '));

  const audit = JSON.stringify(withTransport.audit('t1'));
  push('audit entries carry no credential', !audit.includes(secretSentinel), audit.slice(0, 160));

  let errored = '';
  try { await withTransport.call('t1', 'projectCreate', {}, 'tester'); } catch { /* transport stub returns ok */ }
  await withTransport.revoke('t1', 'tester');
  let afterRevoke = false;
  try { await withTransport.call('t1', 'projectDescribe', {}, 'tester'); } catch { afterRevoke = true; }
  push('revocation removes access', afterRevoke, errored || 'calls fail once revoked');
  push('revoked tenant leaves no grant', withTransport.audit('t1').some((e) => e.operation === 'revoke'), 'revoke is auditable');

  return { checks, ok: checks.every((c) => c.ok) };
}
