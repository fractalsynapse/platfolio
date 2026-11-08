import { Context, Service } from 'cordis';
import { z } from 'zod';
import {
  ManagedCredentialBroker, RelaySecretDelivery, StrictCredentialBroker,
  type CredentialBroker, type DeliveryMode, type RedactionSinks, type SecretDelivery, type VariablePort,
} from '@platfolio/contracts';

const unattachedPort: VariablePort = {
  supportsSealing: () => false,
  upsert: async () => { throw new Error('no provider variable port is attached to this runtime'); },
  entryLink: () => '',
};

/**
 * Custody capability (D20, D21). The mode is configuration, not a branch in the caller: strict holds no
 * credential, managed holds one and refuses to read secrets with it.
 */
export const CustodyConfigSchema = z.object({
  mode: z.enum(['managed', 'strict']),
  delivery: z.enum(['relay-sealed', 'relay-plain', 'tenant-side', 'runner-side']).default('relay-sealed'),
}).strict();

export class CustodyService extends Service<z.infer<typeof CustodyConfigSchema>> {
  static inject = [] as const;
  static provide = 'custody' as const;

  readonly broker: CredentialBroker;
  /** Replaced by attachPorts at the composition root; deliberately mutable so ports are injected, not imported. */
  secrets: SecretDelivery;
  private readonly defaultDelivery: DeliveryMode;

  constructor(ctx: Context, config: z.infer<typeof CustodyConfigSchema>) {
    super(ctx, 'custody');
    const parsed = CustodyConfigSchema.parse(config);
    this.defaultDelivery = parsed.delivery;
    this.broker = parsed.mode === 'strict' ? new StrictCredentialBroker() : new ManagedCredentialBroker();
    // Ports are attached by the composition root; the placeholder refuses so an unattached runtime
    // fails loudly rather than writing secrets into a no-op.
    this.secrets = new RelaySecretDelivery(unattachedPort);
  }

  /** Inject the provider variable port and the surfaces that must never see a value. */
  attachPorts(ports: { variable?: VariablePort; sinks?: RedactionSinks }): void {
    this.secrets = new RelaySecretDelivery(ports.variable ?? unattachedPort, ports.sinks ?? { log: () => {}, record: () => {} });
  }

  get mode(): 'managed' | 'strict' { return this.broker.mode; }

  deliverSecret(target: Parameters<SecretDelivery['deliver']>[0], value: string, mode?: DeliveryMode) {
    return this.secrets.deliver(target, value, mode ?? this.defaultDelivery);
  }
}

declare module 'cordis' {
  interface Context {
    custody: InstanceType<typeof CustodyService>;
  }
}
