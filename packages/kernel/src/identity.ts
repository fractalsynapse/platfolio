import { Context, Service } from 'cordis';
import { z } from 'zod';
import {
  IdentityConfigSchema,
  JwksIdentityProvider,
  StaticKeySource,
  type IdentityConfig,
  type IdentityProvider,
  type Jwk,
  type KeySource,
  type VerificationResult,
} from '@platfolio/contracts';
/**
 * The `identity.provider` capability as a stable `ctx.identity` service.
 *
 * Same seam discipline as `infra` and `custody`: nothing outside this package may import Cordis (D15), and the
 * verifier itself lives in `@platfolio/contracts` so the app layer and the conformance suite exercise one
 * implementation, not two.
 *
 * The failure mode this exists to prevent is specific and ugly: a service that starts, serves traffic, and
 * accepts any well-formed token because the key material was never configured. So an unattached key source is
 * a refusal at the first request — with a message naming the fix — rather than an open door or a crash in a
 * handler.
 */
export const misconfigured = (): VerificationResult => ({
  ok: false,
  code: 'unknown-key',
  message: 'identity has no key source attached; configure PLATFOLIO_IDENTITY_JWKS_URI (or attach a key set at the composition root). Refusing rather than serving unauthenticated traffic.',
});

export class IdentityService extends Service<z.infer<typeof IdentityConfigSchema>> {
  static inject = [] as const;
  static provide = 'identity' as const;
  static Config = IdentityConfigSchema;

  private attached: IdentityProvider | undefined;
  readonly config: IdentityConfig;

  constructor(ctx: Context, config: IdentityConfig) {
    super(ctx, 'identity');
    // The plugin's own config carries the trust parameters; zod applies defaults, so skew and TTL bounds are
    // enforced here rather than remembered by every deployment.
    this.config = config;
  }

  describe() {
    return this.attached?.describe() ?? { provider: 'unattached', contract: '1.0.0', issuer: this.config.issuer, audience: this.config.audience, algorithms: [...this.config.allowedAlgorithms], keySource: 'none -- every verification will be refused' };
  }

  /** Composition root wires the production key source (endpoint) or a test double (static keys). */
  attach(provider: IdentityProvider): void {
    this.attached = provider;
  }

  attachKeys(keys: Jwk[]): void {
    this.attached = new JwksIdentityProvider({ config: this.config, keySource: new StaticKeySource(keys) });
  }

  attachKeySource(source: KeySource): void {
    this.attached = new JwksIdentityProvider({ config: this.config, keySource: source });
  }

  get attached_(): boolean {
    return this.attached !== undefined;
  }

  async verifyAccessToken(token: string, options: { requiredScope?: string; now?: Date } = {}): Promise<VerificationResult> {
    if (!this.attached) return misconfigured();
    return this.attached.verifyAccessToken(token, options);
  }
}

declare module 'cordis' {
  interface Context {
    identity: IdentityService;
  }
}
