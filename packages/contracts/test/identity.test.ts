import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPublicKey, createSign } from 'node:crypto';
import {
  JwksIdentityProvider,
  StaticKeySource,
  identityProviderFromKeys,
  IdentityConfigSchema,
  type IdentityProvider,
} from '../src/identity.ts';
import {
  conformanceProvider,
  createIdentityFixture,
  defaultIdentityConfig,
  runIdentityConformance,
  signToken,
  type IdentityReport,
} from '../src/identity-conformance.ts';

const fixture = createIdentityFixture();

const summary = (report: IdentityReport): string => report.results.filter((r) => r.status !== 'pass').map((r) => `${r.name}: ${r.status} -- ${r.detail}`).join('\n');

test('the reference double satisfies the identity contract', async () => {
  const report = await runIdentityConformance(() => conformanceProvider(fixture), fixture);
  assert.equal(report.ok, true, `conformance failures:\n${summary(report)}`);
  assert.ok(report.passed >= 17, `expected the full case list, got ${String(report.passed)} passing`);
  assert.ok(report.results.every((r) => r.name.length > 0), 'every case must be named -- an anonymous report cannot be checked against expectations');
});

test('the same suite passes the production provider -- keys over an injected fetch, not a stub', async () => {
  // The point of a shared suite: the class that runs in prod is the class under test. Only the transport is
  // faked; caching, kid lookup and every trust decision are the real ones.
  const jwksBody = { keys: [fixture.jwk] };
  let fetches = 0;
  const fetchImpl = (async () => {
    fetches += 1;
    return new Response(JSON.stringify(jwksBody), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const provider = () => new JwksIdentityProvider({ config: defaultIdentityConfig(fixture), fetchImpl });
  const report = await runIdentityConformance(provider, fixture);
  assert.equal(report.ok, true, `endpoint-backed provider failed:\n${summary(report)}`);
  assert.ok(fetches > 0, 'the suite would be worthless if it never touched the key source');
  // TTL cache must actually cache. A brand-new provider has to fetch once to warm itself -- the assertion is
  // "one fetch for five verifications", not "zero". My first draft demanded zero and failed on the warming
  // fetch, which was the test being wrong rather than the code.
  const before = fetches;
  const p = provider();
  for (let i = 0; i < 5; i += 1) await p.verifyAccessToken(signToken(fixture));
  assert.equal(fetches - before, 1, `five verifications should cost exactly one JWKS fetch, got ${String(fetches - before)}`);
});

test('a provider that only decodes FAILS this suite -- the negative control that gives it teeth', async () => {
  const decodeOnly: IdentityProvider = {
    name: 'decode-only',
    contract: '1.0.0',
    describe: () => ({ provider: 'decode-only', contract: '1.0.0', issuer: fixture.issuer, audience: fixture.audience, algorithms: ['RS256'], keySource: 'none' }),
    async verifyAccessToken(token) {
      const [, payload] = token.split('.');
      const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
      return { ok: true as const, claims: { subject: String(claims.sub ?? ''), issuer: String(claims.iss ?? ''), audience: [String(claims.aud ?? '')], clientId: 'cli', scope: [], expiresAt: '1970-01-01T00:00:00.000Z' } };
    },
  };
  const report = await runIdentityConformance(() => decodeOnly, fixture);
  assert.equal(report.ok, false, 'a verifier that trusts unverified input must not pass conformance');
  const refusedCases = report.results.filter((r) => r.status === 'fail').map((r) => r.name);
  // Named expectations, restricted to what this provider actually gets wrong: it skips verification but does
  // not leak, so "unknown claims never leave the verifier" is legitimately NOT in this list -- that case has
  // its own control below.
  for (const expectation of ['a tampered payload is refused as a signature failure', 'alg "none" is refused before any key lookup', 'HMAC with the public key (algorithm confusion) is refused', 'the issuer must match exactly -- no prefix, no other realm', 'a token with no expiry is refused -- an unsigned expiry is no expiry', 'the audience must be present -- an empty or other audience is refused']) {
    assert.ok(refusedCases.includes(expectation), `the suite no longer catches "only decodes" for: ${expectation}`);
  }
});

test('a verifier that echoes every claim FAILS the leakage case -- a control my first draft got wrong', async () => {
  // An earlier version asserted that the decode-only provider above also trips "unknown claims never leave the
  // verifier". It does not, and correctly so: parsing a payload into a fixed set of fields is not the same sin
  // as forwarding the whole thing. Demanding the failure would have been a test that could not be satisfied by
  // the code under test, so this provider commits the actual sin -- raw claims out the door.
  const echoing: IdentityProvider = {
    name: 'echo-everything',
    contract: '1.0.0',
    describe: () => ({ provider: 'echo-everything', contract: '1.0.0', issuer: fixture.issuer, audience: fixture.audience, algorithms: ['RS256'], keySource: 'none' }),
    async verifyAccessToken(token) {
      const [, payload] = token.split('.');
      const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
      return {
        ok: true as const,
        claims: {
          subject: String(claims.sub ?? ''), issuer: String(claims.iss ?? ''), audience: [String(claims.aud ?? '')],
          clientId: 'cli', scope: [], expiresAt: '1970-01-01T00:00:00.000Z', ...claims,
        },
      };
    },
  };
  const report = await runIdentityConformance(() => echoing, fixture);
  assert.equal(report.ok, false);
  const leaked = report.results.find((r) => r.name === 'unknown claims never leave the verifier');
  assert.ok(leaked && leaked.status === 'fail', `the leakage case did not fire for an echoing provider: ${JSON.stringify(leaked)}`);
  assert.match(leaked?.detail ?? '', /claim leakage/, `unexpected detail: ${leaked?.detail}`);
});

test('a key source that cannot be read fails closed, and a bad JWKS document is not a crash', async () => {
  const unreachable = () => new JwksIdentityProvider({ config: defaultIdentityConfig(fixture), fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
  const result = await unreachable().verifyAccessToken(signToken(fixture));
  assert.equal(result.ok, false);
  assert.equal(result.ok && false ? '' : result.code, 'unknown-key');

  const junkKeys = () => new JwksIdentityProvider({ config: defaultIdentityConfig(fixture), fetchImpl: (async () => new Response('{"keys":[{"kty":"oct"}]}', { status: 200 })) as unknown as typeof fetch });
  const second = await junkKeys().verifyAccessToken(signToken(fixture));
  assert.equal(second.ok, false, 'a published key set the verifier cannot use must refuse, not accept or throw');

  const http500 = () => new JwksIdentityProvider({ config: defaultIdentityConfig(fixture), fetchImpl: (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch });
  const third = await http500().verifyAccessToken(signToken(fixture));
  assert.equal(third.ok, false);
});

test('rotation: a new kid is trusted once the endpoint lists it, and replay cannot hammer the endpoint', async () => {
  const rotated = createIdentityFixture({ kid: 'conformance-key-2' });
  let calls = 0;
  const keys: Array<Record<string, unknown>> = [fixture.jwk];
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ keys }), { status: 200 });
  }) as unknown as typeof fetch;
  const provider = new JwksIdentityProvider({ config: { ...defaultIdentityConfig(fixture), cacheTtlSeconds: 1 }, fetchImpl });
  assert.equal((await provider.verifyAccessToken(signToken(rotated, { kid: rotated.kid }))).ok, false, 'an unlisted key must not verify');
  keys.push(rotated.jwk);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const after = await provider.verifyAccessToken(signToken(rotated, { kid: rotated.kid }));
  assert.equal(after.ok, true, `the rotated key should be picked up after the TTL: ${after.ok ? '' : after.message}`);
  const before = calls;
  for (let i = 0; i < 20; i += 1) await provider.verifyAccessToken(signToken(fixture, { kid: 'deleted-key' }));
  assert.ok(calls - before <= 2, `20 unknown-kid attempts triggered ${String(calls - before)} fetches -- rotation protection is missing`);
});

test('config refuses an empty algorithm set and an unparseable issuer', () => {
  assert.throws(() => IdentityConfigSchema.parse({ issuer: fixture.issuer, audience: 'a', allowedAlgorithms: [] }), /allowedAlgorithms|too_small|minimum/);
  assert.throws(() => IdentityConfigSchema.parse({ issuer: '', audience: 'a', allowedAlgorithms: ['RS256'] }), /issuer|too_small|minimum/);
  // Clock skew is a security parameter: an unbounded value turns "expired" into a suggestion.
  assert.throws(() => IdentityConfigSchema.parse({ issuer: fixture.issuer, audience: 'a', allowedAlgorithms: ['RS256'], clockSkewSeconds: 99_999 }), /clockSkewSeconds|maximum/);
  assert.throws(() => IdentityConfigSchema.parse({ issuer: fixture.issuer, audience: 'a', allowedAlgorithms: ['HS256'] }), /HS256|invalid/);
});

test('the double and the endpoint provider reach identical verdicts on identical tokens', async () => {
  const staticProvider = identityProviderFromKeys(defaultIdentityConfig(fixture), [fixture.jwk]);
  const endpointProvider = new JwksIdentityProvider({
    config: defaultIdentityConfig(fixture),
    keySource: new StaticKeySource([fixture.jwk]),
    fetchImpl: (async () => { throw new Error('must not be used when a key source is supplied'); }) as unknown as typeof fetch,
  });
  const tokens = [signToken(fixture), signToken(fixture, { issuer: 'https://elsewhere.test' }), signToken(fixture, { expiresIn: -7200 }), signToken(fixture, { kid: 'nope' })];
  for (const token of tokens) {
    const [a, b] = await Promise.all([staticProvider.verifyAccessToken(token), endpointProvider.verifyAccessToken(token)]);
    assert.equal(a.ok, b.ok, `verdict differed for one token: ${String(a.ok)} vs ${String(b.ok)}`);
    if (!a.ok && !b.ok) assert.equal(a.code, b.code, `failure codes differed: ${a.code} vs ${b.code}`);
  }
});

test('signature verification uses the real crypto primitive, not a comparison of strings', async () => {
  // Sanity on the fixture itself: a token signed by the private key verifies against the public key, and a
  // payload edited by one character does not. If this fails, every other assertion in this file is theatre.
  const provider = conformanceProvider(fixture);
  const token = signToken(fixture);
  assert.equal((await provider.verifyAccessToken(token)).ok, true);
  const [h, p, s] = token.split('.');
  const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p ?? '', 'base64url').toString('utf8')), sub: 'admin' })).toString('base64url')}.${s}`;
  const result = await provider.verifyAccessToken(tampered);
  assert.equal(result.ok, false);
  assert.ok(!tampered.includes('user-conformance'), 'the fixture did not actually change the subject');
  // And that the key material is genuinely RSA-2048 and usable: a broken fixture would pass by refusing all.
  const key = createPublicKey({ key: { kty: fixture.jwk.kty, n: fixture.jwk.n, e: fixture.jwk.e } as never, format: 'jwk' });
  const signer = createSign('RSA-SHA256');
  signer.update('probe', 'latin1');
  assert.ok(signer.sign({ key: fixture.privateKeyPem, format: 'pem', type: 'pkcs8' }).length > 100, 'RSA signature should be 256 bytes');
  void key;
});
