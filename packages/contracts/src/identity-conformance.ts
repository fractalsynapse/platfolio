import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import {
  IDENTITY_CONTRACT_VERSION,
  StaticKeySource,
  identityProviderFromKeys,
  type IdentityConfig,
  type IdentityProvider,
  type Jwk,
  type VerificationFailureCode,
} from './identity.ts';

/**
 * The identity conformance suite (docs/design/10 § the seams, rule of two).
 *
 * An interface written against one implementation is a guess about what the interface has to hold. This suite
 * is the guess made checkable: it passes the real JWKS provider and the static double through the same
 * adversarial cases, and it is written to **fail** a provider that only decodes. A suite that cannot fail a
 * bad implementation is the most expensive kind of green.
 *
 * The cases are the classic JWT attacks plus the boring ones: algorithm confusion, `alg: none`, unknown key,
 * signature mismatch, expiry, not-before, issuer, audience, missing subject, malformed input, scope
 * enforcement, and claim leakage.
 */

export interface IdentityCaseResult {
  name: string;
  status: 'pass' | 'fail' | 'not-implemented';
  detail: string;
}

export interface IdentityReport {
  provider: string;
  contract: string;
  issuer: string;
  audience: string;
  results: IdentityCaseResult[];
  passed: number;
  failed: number;
  unimplemented: number;
  ok: boolean;
}

export interface IdentityFixture {
  issuer: string;
  audience: string;
  kid: string;
  jwk: Jwk;
  privateKeyPem: string;
  /** The same key presented as a secret, for the algorithm-confusion case. */
  publicKeyPem: string;
}

export function createIdentityFixture(overrides: { kid?: string } = {}): IdentityFixture {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  const kid = overrides.kid ?? 'conformance-key-1';
  return {
    issuer: 'https://identity.test/realms/platfolio',
    audience: 'platfolio-api',
    kid,
    jwk: { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, alg: 'RS256', use: 'sig' },
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export const defaultIdentityConfig = (fixture: IdentityFixture): IdentityConfig => ({
  issuer: fixture.issuer,
  audience: fixture.audience,
  allowedAlgorithms: ['RS256'],
  clockSkewSeconds: 30,
  cacheTtlSeconds: 300,
});

export interface TokenOptions {
  issuer?: string;
  audience?: string | string[];
  /** null removes the claim entirely. */
  subject?: string | null;
  expiresIn?: number | null;
  notBeforeIn?: number | null;
  scope?: string;
  kid?: string | null;
  alg?: string;
  environment?: string;
  extra?: Record<string, unknown>;
  /** Sign with something other than the fixture key, to break the signature without breaking the header. */
  secretKey?: 'public-key-as-hmac' | 'wrong-rsa';
  clockOffset?: number;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/** Builds a token the way a real IdP would -- including every way it might not. */
export function signToken(fixture: IdentityFixture, options: TokenOptions = {}): string {
  const now = Math.floor(Date.now() / 1000) + (options.clockOffset ?? 0);
  const alg = options.alg ?? 'RS256';
  const header: Record<string, unknown> = { alg, typ: 'JWT' };
  if (options.kid !== null) header.kid = options.kid ?? fixture.kid;
  const payload: Record<string, unknown> = {
    iss: options.issuer ?? fixture.issuer,
    aud: options.audience ?? fixture.audience,
    azp: 'platfolio-cli',
    ...(options.subject === null ? {} : { sub: options.subject ?? 'user-conformance' }),
    ...(options.expiresIn === null ? {} : { exp: now + (options.expiresIn ?? 300) }),
    ...(options.notBeforeIn === undefined || options.notBeforeIn === null ? {} : { nbf: now + options.notBeforeIn }),
    ...(options.scope === undefined ? {} : { scope: options.scope }),
    ...(options.environment === undefined ? {} : { environment: options.environment }),
    ...(options.extra ?? {}),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = (() => {
    if (options.secretKey === 'public-key-as-hmac') {
      // The algorithm-confusion attack: HMAC the message with the *public* key, which anyone can read.
      const hmac = createHmacLike(fixture.publicKeyPem, signingInput);
      return hmac;
    }
    if (options.secretKey === 'wrong-rsa') {
      const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
      return detachedSign(signingInput, other.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    }
    return detachedSign(signingInput, fixture.privateKeyPem);
  })();
  return `${signingInput}.${signature}`;
}

function detachedSign(data: string, privateKeyPem: string): string {
  const sign = createSign('RSA-SHA256');
  sign.update(data, 'latin1');
  return sign.sign(privateKeyPem).toString('base64url');
}

function createHmacLike(keyPem: string, data: string): string {
  return createHmac('sha256', keyPem).update(data, 'latin1').digest('base64url');
}

type Expectation = { ok: true } | { ok: false; code: VerificationFailureCode | 'any' };
/** What a case body returns. `name` is deliberately absent: the harness owns it (see add). */
type CaseOutcome = { status: IdentityCaseResult['status']; detail: string };

const expectVerify = async (provider: IdentityProvider, token: string, expectation: Expectation, requiredScope?: string): Promise<CaseOutcome> => {
  const result = await provider.verifyAccessToken(token, requiredScope === undefined ? {} : { requiredScope });
  if (expectation.ok) {
    if (!result.ok) return { status: 'fail', detail: `expected acceptance, got ${result.code}: ${result.message}` };
    return { status: 'pass', detail: `accepted subject ${result.claims.subject}` };
  }
  if (result.ok) return { status: 'fail', detail: `expected rejection${expectation.code === 'any' ? '' : ` as ${expectation.code}`}, got claims for ${result.claims.subject}` };
  if (expectation.code !== 'any' && result.code !== expectation.code) return { status: 'fail', detail: `expected code ${expectation.code}, got ${result.code} (${result.message})` };
  return { status: 'pass', detail: `refused as ${result.code}` };
};

/**
 * @param make a fresh provider per case, so cache state cannot leak between expectations
 * @param fixture key material the provider is expected to trust
 */
export async function runIdentityConformance(make: () => IdentityProvider, fixture: IdentityFixture = createIdentityFixture()): Promise<IdentityReport> {
  const results: IdentityCaseResult[] = [];
  const add = async (name: string, run: () => Promise<CaseOutcome>): Promise<void> => {
    try {
      const outcome = await run();
      // Constructed field by field rather than spread after `name`: an earlier version returned a stray
      // `name: ''` from a helper, the spread overwrote the real case title, and every report entry was
      // anonymously titled -- which silently disabled the negative control that checks these by name.
      results.push({ name, status: outcome.status, detail: outcome.detail });
    } catch (error) {
      // Throwing at adversarial input is a failure, not a crash of the suite: a verifier must refuse, not
      // abort, because its caller is a request handler.
      results.push({ name, status: 'fail', detail: `threw: ${(error as Error).message}` });
    }
  };

  const first = make();
  const info = first.describe();
  await add('describe: names the contract, issuer, audience and algorithms', async () => {
    const problems: string[] = [];
    if (info.contract !== IDENTITY_CONTRACT_VERSION) problems.push(`contract ${info.contract} != ${IDENTITY_CONTRACT_VERSION}`);
    if (info.issuer.length === 0) problems.push('issuer not reported');
    if (info.audience.length === 0) problems.push('audience not reported');
    if (!info.algorithms.length) problems.push('no algorithms reported -- an empty allowed set that still verifies is a bug');
    if (info.provider.length === 0) problems.push('provider not named');
    return problems.length ? { status: 'fail', detail: problems.join('; ') } : { status: 'pass', detail: `${info.provider} via ${info.keySource}` };
  });

  await add('a correctly signed, in-window token verifies with the expected claims', async () => {
    const out = await expectVerify(make(), signToken(fixture, { scope: 'platfolio.user offline_access' }), { ok: true });
    if (out.status === 'pass') {
      const claims = (await make().verifyAccessToken(signToken(fixture, { environment: 'production' }))).ok;
      if (!claims) return { status: 'fail', detail: 'the same token failed twice -- verification is not deterministic' };
    }
    return out;
  });

  await add('a tampered payload is refused as a signature failure', async () => {
    const token = signToken(fixture);
    const [h, , s] = token.split('.');
    const evil = b64url(JSON.stringify({ iss: fixture.issuer, aud: fixture.audience, sub: 'attacker', exp: Math.floor(Date.now() / 1000) + 9999 }));
    return expectVerify(make(), `${h}.${evil}.${s}`, { ok: false, code: 'signature' });
  });

  await add('alg "none" is refused before any key lookup', async () => {
    const unsigned = signToken(fixture, { alg: 'none' });
    const [_h, p] = unsigned.split('.');
    // Rebuild with an empty signature segment the way the attack sends it; signToken still signed it.
    const noneHeader = b64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid: fixture.kid }));
    return expectVerify(make(), `${noneHeader}.${p ?? ''}.`, { ok: false, code: 'algorithm' });
  });

  await add('HMAC with the public key (algorithm confusion) is refused', async () => {
    const confused = signToken(fixture, { alg: 'HS256', secretKey: 'public-key-as-hmac' });
    return expectVerify(make(), confused, { ok: false, code: 'algorithm' });
  });

  await add('a signature from a key we do not hold is refused', async () => {
    return expectVerify(make(), signToken(fixture, { secretKey: 'wrong-rsa' }), { ok: false, code: 'signature' });
  });

  await add('an unknown kid is refused as unknown-key, not as signature', async () => {
    return expectVerify(make(), signToken(fixture, { kid: 'revoked-key-9' }), { ok: false, code: 'unknown-key' });
  });

  await add('an expired token is refused, and one expired inside the skew window is accepted', async () => {
    const provider = make();
    const stale = await expectVerify(provider, signToken(fixture, { clockOffset: -3600 }), { ok: false, code: 'expired' });
    if (stale.status === 'fail') return stale;
    const justExpired = await expectVerify(make(), signToken(fixture, { expiresIn: -10 }), { ok: true });
    return justExpired.status === 'pass'
      ? { status: 'pass', detail: `${stale.detail}; ${justExpired.detail}` }
      : { status: 'fail', detail: `clock skew of ${String(defaultIdentityConfig(fixture).clockSkewSeconds)}s was not honoured: ${justExpired.detail}` };
  });

  await add('a not-yet-valid token is refused', async () => {
    const provider = make();
    const early = await provider.verifyAccessToken(signToken(fixture, { clockOffset: -600, notBeforeIn: 120 }));
    if (early.ok) return { status: 'fail', detail: 'accepted a token whose nbf is in the future' };
    // Whether nbf lands as not-yet-valid or expired depends on which bound fails first; both are correct.
    const acceptable: VerificationFailureCode[] = ['not-yet-valid', 'expired'];
    return acceptable.includes(early.code)
      ? { status: 'pass', detail: `refused as ${early.code}` }
      : { status: 'fail', detail: `refused as ${early.code}, which is neither nbf nor exp` };
  });

  await add('the issuer must match exactly -- no prefix, no other realm', async () => {
    for (const issuer of ['https://evil.test/realms/platfolio', `${fixture.issuer}/extra`, 'https://identity.test']) {
      const out = await expectVerify(make(), signToken(fixture, { issuer }), { ok: false, code: 'issuer' });
      if (out.status === 'fail') return out;
    }
    return { status: 'pass', detail: 'three issuer substitutions refused' };
  });

  await add('the audience must be present -- an empty or other audience is refused', async () => {
    const wrong = await expectVerify(make(), signToken(fixture, { audience: 'some-other-api' }), { ok: false, code: 'audience' });
    if (wrong.status === 'fail') return wrong;
    const multi = await expectVerify(make(), signToken(fixture, { audience: ['other-client', fixture.audience] }), { ok: true });
    if (multi.status === 'fail') return { status: 'fail', detail: `a token carrying the right audience among several must verify: ${multi.detail}` };
    return { status: 'pass', detail: 'wrong audience refused, multi-audience accepted' };
  });

  await add('a missing subject is refused', async () => {
    return expectVerify(make(), signToken(fixture, { subject: null }), { ok: false, code: 'subject' });
  });

  await add('a token with no expiry is refused -- an unsigned expiry is no expiry', async () => {
    return expectVerify(make(), signToken(fixture, { expiresIn: null }), { ok: false, code: 'malformed' });
  });

  await add('required scope is enforced when asked for', async () => {
    const without = await expectVerify(make(), signToken(fixture), { ok: false, code: 'scope' }, 'platfolio.user');
    if (without.status === 'fail') return without;
    return expectVerify(make(), signToken(fixture, { scope: 'platfolio.user' }), { ok: true }, 'platfolio.user');
  });

  await add('unknown claims never leave the verifier', async () => {
    const provider = make();
    const token = signToken(fixture, { extra: { secret: 'hunter2', tenantAuthority: true, password: 'let-me-in' } });
    const result = await provider.verifyAccessToken(token);
    if (!result.ok) return { status: 'fail', detail: `a well-formed token was refused: ${result.code} (${result.message})` };
    const leaked = JSON.stringify(result.claims);
    for (const needle of ['hunter2', 'let-me-in', 'tenantAuthority', 'secret', 'password']) {
      if (leaked.includes(needle)) return { status: 'fail', detail: `claim leakage: "${needle}" appeared in verified claims` };
    }
    return { status: 'pass', detail: 'only the allow-listed claims survived' };
  });

  await add('the environment claim is carried when present (the production gate depends on it)', async () => {
    const provider = make();
    const withEnv = await provider.verifyAccessToken(signToken(fixture, { environment: 'production' }));
    if (!withEnv.ok) return { status: 'fail', detail: `refused a valid token: ${withEnv.code}` };
    if (withEnv.claims.environment !== 'production') return { status: 'fail', detail: 'environment claim dropped' };
    const withoutEnv = await provider.verifyAccessToken(signToken(fixture));
    if (!withoutEnv.ok) return { status: 'fail', detail: 'refused a token without the optional claim' };
    return withoutEnv.claims.environment === undefined ? { status: 'pass', detail: 'present when sent, absent when not' } : { status: 'fail', detail: `invented an environment claim: ${String(withoutEnv.claims.environment)}` };
  });

  await add('malformed input is refused, never thrown', async () => {
    const provider = make();
    const junk = ['x', '', 'a.b', 'a.b.c', 'not.base64!!', '###.###.###', `${b64url('{"alg":"RS256"}')}.${b64url('not json')}.AAA`];
    const codes: string[] = [];
    for (const candidate of junk) {
      const result = await provider.verifyAccessToken(candidate);
      if (result.ok) return { status: 'fail', detail: `accepted junk input: ${JSON.stringify(candidate)}` };
      codes.push(result.code);
    }
    return codes.every((c) => c === 'malformed' || c === 'algorithm' || c === 'unknown-key' || c === 'signature')
      ? { status: 'pass', detail: `seven junk inputs refused (${codes.join(', ')})` }
      : { status: 'fail', detail: `junk produced an unexpected code set: ${codes.join(', ')}` };
  });

  await add('a second provider from the same fixture agrees (no per-instance trust drift)', async () => {
    const token = signToken(fixture, { scope: 'platfolio.user' });
    const [a, b] = await Promise.all([make().verifyAccessToken(token), make().verifyAccessToken(token)]);
    if (!a.ok || !b.ok) return { status: 'fail', detail: 'two instances disagreed on the same token' };
    return a.claims.subject === b.claims.subject ? { status: 'pass', detail: 'identical verdicts' } : { status: 'fail', detail: `${a.claims.subject} vs ${b.claims.subject}` };
  });

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const unimplemented = results.filter((r) => r.status === 'not-implemented').length;
  return {
    provider: info.provider,
    contract: info.contract,
    issuer: info.issuer,
    audience: info.audience,
    results,
    passed,
    failed,
    unimplemented,
    // Unimplemented counts as not-conformant here on purpose: a verifier that skips the environment claim is
    // not "partially green", it is missing a case the production gate needs.
    ok: failed === 0 && unimplemented === 0,
  };
}

/** The reference double, built the way the docs describe the cheap second implementation. */
export function conformanceProvider(fixture: IdentityFixture): IdentityProvider {
  return identityProviderFromKeys(defaultIdentityConfig(fixture), [fixture.jwk]);
}

/** Re-exported so a test can build a key source without reaching into the implementation module. */
export { StaticKeySource };
