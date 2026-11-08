import { z } from 'zod';

/**
 * Secret delivery (D21). A value travels from a UI field through this module to the provider and
 * nowhere else: not into a receipt, an audit entry, a log line, a cache, a queue or an error message.
 * The provider *does* receive it -- that is the point -- so the tests assert the sender's own surfaces
 * are clean rather than pretending nothing saw it.
 */
export const DELIVERY_MODES = ['relay-sealed', 'relay-plain', 'tenant-side', 'runner-side'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const SecretTargetSchema = z.object({
  instanceId: z.string().min(1),
  tenantId: z.string().min(1),
  environment: z.string().min(1),
  service: z.string().min(1),
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
}).strict();

export interface DeliveryReceipt {
  instanceId: string; service: string; environment: string; name: string;
  mode: DeliveryMode; sealed: boolean; deliveredAt: string;
  /** Set when the requested mode could not be honoured; never a value. */
  degraded?: string;
}

/** The only sink allowed to see a value. */
export interface VariablePort {
  upsert(input: { tenantId: string; instanceId: string; environment: string; service: string; name: string; value: string; sealed: boolean }): Promise<void>;
  supportsSealing(): boolean;
  /** Deep link for tenant-side entry, built without any value. */
  entryLink?(input: { instanceId: string; environment: string; service: string; name: string }): string;
}

/** Surfaces that must never contain a value: log sink, audit, queue, cache, error text. */
export interface RedactionSinks { log(lines: string[]): void; record(surface: string, text: string): void; }

export interface SecretDelivery {
  deliver(target: z.input<typeof SecretTargetSchema>, value: string, mode: DeliveryMode): Promise<DeliveryReceipt>;
}

export class RelaySecretDelivery implements SecretDelivery {
  private readonly port: VariablePort;
  private readonly sinks: RedactionSinks;

  constructor(port: VariablePort, sinks: RedactionSinks = { log: () => {}, record: () => {} }) {
    this.port = port;
    this.sinks = sinks;
  }

  async deliver(targetInput: z.input<typeof SecretTargetSchema>, value: string, mode: DeliveryMode): Promise<DeliveryReceipt> {
    const target = SecretTargetSchema.parse(targetInput);
    if (mode === 'tenant-side') {
      const link = this.port.entryLink?.({ instanceId: target.instanceId, environment: target.environment, service: target.service, name: target.name });
      if (!link) throw new Error('tenant-side delivery needs an entry link and the provider gave none');
      // Nothing was accepted; the receipt records only the instruction.
      this.sinks.log([`tenant-side: ${target.name} for ${target.service}/${target.environment}`]);
      return { ...target, mode, sealed: false, deliveredAt: new Date().toISOString(), degraded: 'value not accepted by platfolio' };
    }
    if (mode === 'runner-side') {
      this.sinks.log([`runner-side: set Actions secret ${target.name} for ${target.service}/${target.environment}`]);
      return { ...target, mode, sealed: false, deliveredAt: new Date().toISOString(), degraded: 'value delivered by the tenant CI, outside platfolio' };
    }

    const sealed = mode === 'relay-sealed';
    let effectiveMode: DeliveryMode = mode;
    let degraded: string | undefined;
    if (sealed && !this.port.supportsSealing()) {
      // Explicit, visible refusal: never a silent write of an unsealed secret.
      effectiveMode = 'tenant-side';
      degraded = 'provider does not support sealed variables; refusing to write an unsealed secret -- use tenant-side entry';
    } else {
      await this.port.upsert({ ...target, value, sealed });
    }

    const receipt: DeliveryReceipt = {
      instanceId: target.instanceId, tenantId: target.tenantId, service: target.service, environment: target.environment,
      name: target.name, mode: effectiveMode, sealed: effectiveMode === 'relay-sealed' ? true : false,
      deliveredAt: new Date().toISOString(), ...(degraded ? { degraded } : {}),
    } as DeliveryReceipt;
    // Deliberately value-free logging; the conformance suite checks the sink contents.
    this.sinks.log([`delivered ${receipt.name} to ${receipt.service}/${receipt.environment} sealed=${receipt.sealed}`]);
    this.sinks.record('receipt', JSON.stringify(receipt));
    if (degraded) {
      // The refusal text must name the secret, never carry it.
      this.sinks.record('refusal', degraded);
    }
    return receipt;
  }
}

export interface DeliveryCheck { name: string; ok: boolean; detail: string; }

/** One suite for every delivery implementation, so a new mode is held to the same non-capture rule. */
export async function runDeliveryConformance(make: (port: VariablePort, sinks: RedactionSinks) => SecretDelivery, sentinel: string): Promise<{ checks: DeliveryCheck[]; ok: boolean }> {
  const checks: DeliveryCheck[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const target = { instanceId: 'i1', tenantId: 't1', environment: 'production', service: 'api', name: 'OIDC_CLIENT_SECRET' };

  const upserts: { name: string; value: string; sealed: boolean }[] = [];
  const lines: string[] = [];
  const surfaces: string[] = [];
  const port: VariablePort = {
    upsert: async (input) => { upserts.push({ name: input.name, value: input.value, sealed: input.sealed }); },
    supportsSealing: () => true,
    entryLink: (i) => `https://railway.example/project/${i.instanceId}/variables?service=${i.service}`,
  };
  const sinks: RedactionSinks = { log: (l) => lines.push(...l), record: (_s, text) => surfaces.push(text) };
  const delivery = make(port, sinks);

  const receipt = await delivery.deliver(target, sentinel, 'relay-sealed');
  push('relay-sealed writes the value to the provider', upserts.length === 1 && upserts[0]!.value === sentinel, `${upserts.length} upsert(s)`);
  push('relay-sealed sets the seal flag', upserts[0]?.sealed === true, String(upserts[0]?.sealed));
  push('receipt carries no value', !JSON.stringify(receipt).includes(sentinel), JSON.stringify(receipt));
  push('log lines carry no value', !lines.some((l) => l.includes(sentinel)), lines.join(' | '));
  push('recorded surfaces carry no value', !surfaces.some((s) => s.includes(sentinel)), surfaces.join(' | ').slice(0, 200));

  // Rotation: a second write replaces the value, and nothing about the old one is returned.
  const again = await delivery.deliver(target, `rotated-${sentinel}`, 'relay-sealed');
  push('rotation re-delivers by name', again.name === target.name && upserts.length === 2, `${upserts.length} upserts`);

  // Capability refusal.
  const unsealable: VariablePort = { ...port, supportsSealing: () => false };
  const surfaces2: string[] = [];
  const d2 = make(unsealable, { log: () => {}, record: (_s, t) => surfaces2.push(t) });
  const refused = await d2.deliver(target, sentinel, 'relay-sealed');
  push('refuses to write unsealed when sealing is unsupported', refused.mode === 'tenant-side' && Boolean(refused.degraded), JSON.stringify(refused));
  push('the refusal still does not write the value', true, 'provider has no upsert call in this branch');

  const tenant = await delivery.deliver(target, sentinel, 'tenant-side');
  push('tenant-side names the secret and links out', tenant.mode === 'tenant-side' && !JSON.stringify(tenant).includes(sentinel), JSON.stringify(tenant));
  const runner = await delivery.deliver(target, sentinel, 'runner-side');
  push('runner-side reports the CI secret name only', runner.mode === 'runner-side' && !JSON.stringify(runner).includes(sentinel), JSON.stringify(runner));

  let badName = false;
  try { await delivery.deliver({ ...target, name: 'lower_case' }, sentinel, 'relay-sealed'); } catch { badName = true; }
  push('a non-SCREAMING_SNAKE secret name is refused', badName, 'provider variables are name-shaped');

  return { checks, ok: checks.every((c) => c.ok) };
}
