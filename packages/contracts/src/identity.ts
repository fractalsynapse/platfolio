import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { z } from 'zod';

/**
 * The `identity.provider` seam (docs/design/10, D40).
 *
 * One job: turn an untrusted string into **verified** claims, or refuse. The distinction is the whole
 * capability — a JWT is signed text that anyone can decode, and every security property of platfolio's
 * interfaces depends on the difference between "I parsed a token" and "I checked this token against the key
 * set of the issuer it claims to come from". #159 exists because the execution plane currently records an
 * unverified token; this is the piece that closes it.
 *
 * Deliberately absent: refresh tokens, session state, user records, logout. Those are Keycloak's business —
 * platfolio verifies bearer tokens and stores nothing about the credential beyond the claims it echoes
 * allow-listed (D4 applies to identity material too).
 */

export const IDENTITY_CONTRACT = 'identity.provider';
export const IDENTITY_CONTRACT_VERSION = '1.0.0';

export const JwkSchema = z.object({
  kty: z.string().min(1),
  use: z.enum(['sig', 'enc']).optional(),
  alg: z.string().optional(),
  kid: z.string().min(1),
  n: z.string().min(1),
  e: z.string().min(1),
}).strip();
export type Jwk = z.infer<typeof JwkSchema>;

/** Claims allowed out of a token. Unknown claim names never leave the verifier. */
export const VerifiedClaimsSchema = z.object({
  subject: z.string().min(1),
  issuer: z.string().min(1),
  audience: z.array(z.string()).min(1),
  clientId: z.string().min(1),
  scope: z.array(z.string()),
  expiresAt: z.string().min(1),
  /** GitHub-environment claim, carried only when present; the production gate in the attestation contract needs it. */
  environment: z.string().optional(),
  /**
   * The identity provider's own assertion about this person's address (D46), read from the token and never
   * supplied by the caller. An invitation is accepted by whoever the IdP says owns the address; a request body
   * claiming "my email is..." would make the root of trust a typed string -- the authorization-by-mailbox
   * problem D46 explicitly declines to create.
   */
  email: z.string().min(3).max(320).optional(),
  /** `email_verified` in the IdP's vocabulary. Absent means not asserted, which is NOT the same as true. */
  emailVerified: z.boolean().optional(),
});
export type VerifiedClaims = z.infer<typeof VerifiedClaimsSchema>;

export type VerificationFailureCode =
  | 'malformed'
  | 'algorithm'
  | 'unknown-key'
  | 'signature'
  | 'expired'
  | 'not-yet-valid'
  | 'issuer'
  | 'audience'
  | 'scope'
  | 'subject';

export interface VerificationFailure {
  ok: false;
  code: VerificationFailureCode;
  message: string;
}
export interface VerificationSuccess {
  ok: true;
  claims: VerifiedClaims;
}
export type VerificationResult = VerificationSuccess | VerificationFailure;

export const IdentityConfigSchema = z.object({
  /** Exact string match against `iss`. No prefix tricks, no tenant wildcard: D4's cross-tenant rule. */
  issuer: z.string().min(1),
  /** The audience a token must carry. Keycloak puts the client id here unless an audience mapper adds one. */
  audience: z.string().min(1),
  /** Where keys come from. Explicit wins over discovery so a misconfigured issuer cannot fall open. */
  jwksUri: z.string().min(1).optional(),
  allowedAlgorithms: z.array(z.enum(['RS256'])).min(1).default(['RS256']),
  clockSkewSeconds: z.number().int().min(0).max(120).default(30),
  cacheTtlSeconds: z.number().int().min(1).default(300),
}).strict();
export type IdentityConfig = z.infer<typeof IdentityConfigSchema>;

export interface KeySource {
  /** Keys currently trusted for this issuer. Implementations own caching and refresh policy. */
  keys(): Promise<Jwk[]>;
  describe(): string;
}

export interface IdentityProvider {
  readonly name: string;
  readonly contract: string;
  describe(): { provider: string; contract: string; issuer: string; audience: string; algorithms: string[]; keySource: string };
  verifyAccessToken(token: string, options?: { requiredScope?: string; now?: Date }): Promise<VerificationResult>;
}

const b64urlJson = (segment: string): unknown => {
  const text = Buffer.from(segment, 'base64url').toString('utf8');
  return JSON.parse(text) as unknown;
};

const fail = (code: VerificationFailureCode, message: string): VerificationFailure => ({ ok: false, code, message });

/**
 * Structure and signature only — no trust decisions. Split out so a key source and a verifier can share one
 * parsing path, and so "it decoded" is never on the same code path as "it verified".
 */
type Extracted = { ok: true; header: Record<string, unknown>; payload: Record<string, unknown>; signingInput: string; signature: Buffer };

function extract(token: string, allowedAlgorithms: readonly string[]): Extracted | VerificationFailure {
  const parts = token.split('.');
  if (parts.length !== 3) return fail('malformed', `a JWT has three dot-separated segments; got ${String(parts.length)}`);
  const [headerSegment = '', payloadSegment = '', signatureSegment = ''] = parts;
  if (!headerSegment || !payloadSegment) return fail('malformed', 'empty header or payload segment');
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = b64urlJson(headerSegment) as Record<string, unknown>;
    payload = b64urlJson(payloadSegment) as Record<string, unknown>;
  } catch {
    return fail('malformed', 'header and payload must be base64url-encoded JSON');
  }
  const alg = String(header.alg ?? '');
  // The allowed set is checked before the key is even looked up. `alg: none` and an HMAC token signed with
  // the public key (algorithm confusion) are the two classic ways a verifier is fooled, and both are header
  // properties: refusing them here means a key source never sees a request to "verify HS256 with this RSA key".
  if (!allowedAlgorithms.includes(alg)) return fail('algorithm', `alg "${alg || '(none)'}" is not in the allowed set [${allowedAlgorithms.join(', ')}]`);
  const kid = header.kid;
  if (typeof kid !== 'string' || kid.length === 0) return fail('malformed', 'no kid header -- the key to verify against is not identified');
  // Tagged, so the caller narrows on `ok` instead of on "does this object have a signingInput field" -- the
  // union of a failure and an untagged struct is what made TypeScript refuse to discriminate it.
  return { ok: true, header, payload, signingInput: `${headerSegment}.${payloadSegment}`, signature: Buffer.from(signatureSegment, 'base64url') };
}

function rsaVerify(jwk: Jwk, signingInput: string, signature: Buffer, alg: string): boolean {
  if (alg !== 'RS256') return false;
  if (jwk.kty !== 'RSA') return false;
  try {
    const key = createPublicKey({ key: { kty: jwk.kty, kid: jwk.kid, n: jwk.n, e: jwk.e, alg: jwk.alg } as never, format: 'jwk' });
    return cryptoVerify('sha256', Buffer.from(signingInput, 'latin1'), key, signature);
  } catch {
    // A malformed key is a verification failure, not a crash: one bad JWK in a published set must not take the
    // control plane down, because the attacker controls that document.
    return false;
  }
}

/** Trust decisions: issuer, audience, time window, subject, optional scope. */
function judge(payload: Record<string, unknown>, config: IdentityConfig, requiredScope: string | undefined, now: Date): VerificationResult {
  if (String(payload.iss ?? '') !== config.issuer) return fail('issuer', `iss "${String(payload.iss ?? '(absent)')}" is not the configured issuer "${config.issuer}"`);
  const aud = Array.isArray(payload.aud) ? payload.aud.map(String) : payload.aud === undefined ? [] : [String(payload.aud)];
  if (!aud.includes(config.audience)) return fail('audience', `token audience [${aud.join(', ') || '(empty)'}] does not include "${config.audience}"`);
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return fail('subject', 'no subject claim');
  const skewMs = config.clockSkewSeconds * 1000;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp)) return fail('malformed', 'exp is missing or not numeric -- an unsigned expiry is no expiry');
  if (exp * 1000 + skewMs < now.getTime()) return fail('expired', `token expired at ${new Date(exp * 1000).toISOString()}`);
  const nbf = Number(payload.nbf);
  if (Number.isFinite(nbf) && nbf * 1000 - skewMs > now.getTime()) return fail('not-yet-valid', `token is not valid before ${new Date(nbf * 1000).toISOString()}`);
  const scope = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : Array.isArray(payload.scope) ? payload.scope.map(String) : [];
  if (requiredScope !== undefined && !scope.includes(requiredScope)) return fail('scope', `required scope "${requiredScope}" not granted (token has: ${scope.join(', ') || 'none'})`);
  const clientId = typeof payload.azp === 'string' && payload.azp ? payload.azp : typeof payload.client_id === 'string' ? payload.client_id : '';
  const environment = typeof payload.environment === 'string' ? payload.environment : undefined;
  const email = typeof payload.email === 'string' && payload.email.length > 0 ? payload.email : undefined;
  const emailVerified = typeof payload.email_verified === 'boolean' ? payload.email_verified : undefined;
  const parsed = VerifiedClaimsSchema.safeParse({
    subject: payload.sub,
    issuer: String(payload.iss),
    audience: aud,
    clientId,
    scope,
    expiresAt: new Date(exp * 1000).toISOString(),
    ...(environment === undefined ? {} : { environment }),
    ...(email === undefined ? {} : { email }),
    ...(emailVerified === undefined ? {} : { emailVerified }),
  });
  if (!parsed.success) return fail('malformed', `claims did not satisfy the verified shape: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  return { ok: true, claims: parsed.data };
}

/**
 * The production verifier. `fetch` is injected so the conformance suite runs this same class with no network,
 * and so a test that fakes a key rotation is exercising the real cache and refresh paths, not a stub of them.
 */
export class JwksIdentityProvider implements IdentityProvider {
  readonly name = 'jwks';
  readonly contract = IDENTITY_CONTRACT_VERSION;
  private readonly config: IdentityConfig;
  private readonly source: KeySource;

  constructor(options: { config: IdentityConfig; keySource?: KeySource; fetchImpl?: typeof fetch }) {
    this.config = IdentityConfigSchema.parse(options.config);
    const fetchImpl = options.fetchImpl ?? fetch;
    this.source = options.keySource ?? new EndpointKeySource(this.config, fetchImpl);
  }

  describe() {
    return {
      provider: this.name,
      contract: this.contract,
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: [...this.config.allowedAlgorithms],
      keySource: this.source.describe(),
    };
  }

  async verifyAccessToken(token: string, options: { requiredScope?: string; now?: Date } = {}): Promise<VerificationResult> {
    const extracted = extract(token, this.config.allowedAlgorithms);
    if (!extracted.ok) return extracted;
    let keys: Jwk[];
    try {
      keys = await this.source.keys();
    } catch (error) {
      return fail('unknown-key', `key set could not be read: ${(error as Error).message}`);
    }
    const kid = String(extracted.header.kid);
    const candidates = keys.filter((k) => k.kid === kid);
    if (candidates.length === 0) return fail('unknown-key', `kid "${kid}" is not in the issuer's current key set`);
    const signatureOk = candidates.some((k) => rsaVerify(k, extracted.signingInput, extracted.signature, String(extracted.header.alg)));
    if (!signatureOk) return fail('signature', `signature does not verify against any key with kid "${kid}"`);
    // Signature first, claims second: a token whose bytes are not authentic has no right to inform us about
    // anything, including whether it is expired.
    return judge(extracted.payload, this.config, options.requiredScope, options.now ?? new Date());
  }
}

/** JWKS over HTTP, with a TTL cache and a single refresh when an unknown kid appears. */
export class EndpointKeySource implements KeySource {
  private cached: { keys: Jwk[]; fetchedAt: number } | undefined;
  private refreshedFor: string | undefined;
  // Written as explicit fields: the repo compiles with erasableSyntaxOnly, which forbids TypeScript's
  // constructor parameter properties because they emit real assignments.
  private readonly config: IdentityConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly uri: string | undefined;

  constructor(config: IdentityConfig, fetchImpl: typeof fetch, uri?: string) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.uri = uri;
  }

  private get url(): string {
    return this.uri ?? `${this.config.issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
  }

  describe(): string {
    return `endpoint ${this.url}`;
  }

  async keys(): Promise<Jwk[]> {
    const ttl = this.config.cacheTtlSeconds * 1000;
    if (this.cached && Date.now() - this.cached.fetchedAt < ttl) return this.cached.keys;
    const response = await this.fetchImpl(this.url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`JWKS fetch failed (${String(response.status)}) from ${this.url}`);
    const body = (await response.json()) as { keys?: unknown[] };
    const parsed = z.array(JwkSchema).safeParse(body.keys ?? []);
    if (!parsed.success) throw new Error(`JWKS at ${this.url} is not a key set this verifier can use`);
    this.cached = { keys: parsed.data, fetchedAt: Date.now() };
    return this.cached.keys;
  }

  /**
   * Rotation-tolerant read: an unknown kid triggers exactly one refetch per kid. Without the guard, replaying
   * a token signed by a deleted key turns authentication attempts into a denial-of-service against the
   * issuer's own endpoint.
   */
  async keysForcingRefresh(kid: string): Promise<Jwk[]> {
    if (this.refreshedFor !== kid) {
      this.refreshedFor = kid;
      this.cached = undefined;
    }
    return this.keys();
  }
}

/** The conformance double: keys supplied in-process, no network, same class of decisions. */
export class StaticKeySource implements KeySource {
  private readonly keysList: Jwk[];

  constructor(keysList: Jwk[]) {
    this.keysList = keysList;
  }
  describe(): string {
    return `static (${String(this.keysList.length)} key(s))`;
  }
  async keys(): Promise<Jwk[]> {
    return this.keysList;
  }
}

export function identityProviderFromKeys(config: IdentityConfig, keys: Jwk[]): JwksIdentityProvider {
  return new JwksIdentityProvider({ config: IdentityConfigSchema.parse(config), keySource: new StaticKeySource(keys) });
}
