import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENDPOINTS } from '@platfolio/api-contract/generated/types';
import {
  ShellContextConflict,
  createShellContext,
  resetShellContextForTests,
  shellContextCount,
  type ShellCapabilities,
  type ShellEndpoints,
} from '../src/index.ts';

/**
 * D65's exactly-once claim, run rather than read.
 *
 * The decision names its own risk in one sentence: *"the island constructs the SDK context and the signal registry
 * **exactly once**, because a second hydration means two registries and two token stores."* Two SDK contexts means
 * two transports, so two freshness clocks — one panel saying "4s ago" beside another saying "90s ago" about the
 * same operation. Two `SignalBus` objects means a context switch emitted into one and unheard by the other, which
 * is the silent half: nothing throws, the screen simply stops agreeing with itself. Two token bags means two
 * refresh schedules for one session, which is how a refresh becomes a 401 nobody can explain.
 *
 * `apps/site/test/island-singleton.test.ts` counts construction sites in the shell's source, and
 * `apps/site/test/build-output.test.ts` counts island elements in the built artifact. Neither can say what happens
 * when the guarantee is *exercised*, so this file does — in Node, with no DOM, no hydration and no browser. That is
 * possible because `createShellContext` deliberately touches nothing browser-specific while constructing: the four
 * capabilities a browser owns arrive as injected functions, so a test can drive the singleton the way a page does.
 *
 * Three properties, the middle one being the case that would otherwise stay invisible:
 *
 *  1. the same endpoints asked for twice return the **same object** — a double hydration is harmless by
 *     construction, which is what makes the mistake survivable;
 *  2. **different** endpoints are refused, by name — two contexts disagreeing about where the API lives is the
 *     shape of a bad deploy, and it has to be a crash at boot rather than a screen that quietly reads staging;
 *  3. the transport that comes out of the context routes from the generated `ENDPOINTS` table (#258): a shell
 *     supplies a base URL, never a route list.
 *
 * What this is not: a claim that a browser hydrated one root. There is no Playwright in this repository, 11 §9.7
 * and §9.8 stay NOT RUN for that reason, and this file does not upgrade that verdict by inference. The count is
 * also per JS realm rather than global — a second *document* is a second realm with its own context, which is
 * correct behaviour. `resetShellContextForTests` exists so these three cases cannot leak into one another, and is
 * named so a page cannot reach for it by accident.
 */

const ENDPOINT_A: ShellEndpoints = {
  apiBaseUrl: 'https://api.a.test.example',
  issuerBaseUrl: 'https://auth.a.test.example/realms/platfolio',
  siteOrigin: 'https://a.test.example',
};

const ENDPOINT_B: ShellEndpoints = {
  apiBaseUrl: 'https://api.b.test.example',
  issuerBaseUrl: 'https://auth.b.test.example/realms/platfolio',
  siteOrigin: 'https://b.test.example',
};

/**
 * The four capabilities, as doubles. Nothing here reaches a network, a digest, an entropy source or a storage API
 * — which is also the point of the seam: the production answers are `fetch`, `crypto.subtle.digest`,
 * `crypto.getRandomValues` and `sessionStorage`, and a native or desktop shell may answer all four differently
 * without this package noticing (11 §1's portability pass, R9).
 */
const capabilities = (): ShellCapabilities => {
  const store = new Map<string, string>();
  return {
    request: async () => ({ status: 500, body: '{"error":"a test never reaches an issuer"}' }),
    digest: async (bytes) => bytes,
    random: (length) => new Uint8Array(length).fill(7),
    handoff: {
      read: (key) => store.get(key),
      write: (key, value) => store.set(key, value),
      drop: (key) => { store.delete(key); },
    },
  };
};

test('the same endpoints answered twice are one context, not two', () => {
  resetShellContextForTests();
  const first = createShellContext(ENDPOINT_A, capabilities());
  const second = createShellContext(ENDPOINT_A, capabilities());

  assert.equal(second, first, "a second construction with the same configuration returned a different object: that is D65's second registry, and a double hydration was supposed to be harmless rather than fatal");
  assert.equal(second.sdk, first.sdk, 'two SDK contexts mean two transports and two freshness clocks');
  assert.equal(second.signals, first.signals, 'two signal buses mean a context switch emitted into one and unheard by the other');
  assert.equal(second.auth, first.auth, 'two token bags mean two refresh schedules for one session');
  assert.equal(shellContextCount(), 1, `one realm, one configuration, ${String(shellContextCount())} contexts built`);
});

test('different endpoints are refused by name, and the refusal carries no credential vocabulary', () => {
  resetShellContextForTests();
  createShellContext(ENDPOINT_A, capabilities());

  assert.throws(
    () => createShellContext(ENDPOINT_B, capabilities()),
    (error: ShellContextConflict) => {
      assert.match(error.message, /api\.a\.test\.example/, 'the message has to name the configuration already in force, or an operator is reading a sentence about nothing');
      assert.match(error.message, /api\.b\.test\.example/, 'and the one being refused');
      assert.match(error.message, /D65/, 'and say which decision it enforces, because this throw is a policy and not a stack accident');
      // The word "token" appears in the message ("two registries and two token stores"), and that is a description
      // of a failure rather than a credential in one: what must not appear is a token-*shaped* field or a JWT
      // body. Asserting on the word instead would have failed the compliant case, which is the mistake 11 §8's
      // `aria-live` story records and gate §R5 now refuses in both directions.
      assert.ok(!/access_token|refresh_token|id_token|code_verifier|client_secret|eyJ[A-Za-z0-9_-]{8,}/.test(error.message), 'a configuration error must not carry a credential or a credential-shaped field (D4)');
      return true;
    },
    'two contexts disagreeing about where the API lives is a deploy fault, and it has to arrive as one',
  );

  assert.equal(shellContextCount(), 1, 'the refusal must not leave a second context behind');
});

test('the transport the context hands over routes from the generated table, not one the shell typed', () => {
  resetShellContextForTests();
  const shell = createShellContext(ENDPOINT_A, capabilities());

  assert.equal(shell.transport.kind, 'poll', 'D64: poll is the only driver that exists today, and the shell must not pretend otherwise');
  const table = (shell.transport as unknown as { routeTable?: typeof ENDPOINTS }).routeTable;
  assert.ok(table, 'PollTransport exposes no route table, so this file cannot say which table the island routes from');
  assert.equal(table, ENDPOINTS, 'the endpoints are not the generated ones (#258): a shell that supplied its own table would be a second source of truth about the API');

  const entries = Object.values(table);
  assert.ok(entries.length > 0, 'the generated table is empty, which would make "it is the generated one" a claim about nothing');
  assert.deepEqual(
    [...new Set(entries.map((entry) => entry.method))].sort(),
    ['delete', 'get', 'post', 'put'],
    'the method vocabulary changed shape -- re-read the generated table before this island ships, because the transport builds requests from these values',
  );
  // List the operational routes explicitly so each unversioned path is reviewed against the OpenAPI spec.
  const unversioned = [...new Set(entries.map((entry) => entry.path).filter((p) => !p.startsWith('/api/v1/')))].sort();
  assert.deepEqual(unversioned, ['/healthz', '/readyz', '/status', '/version'], 'the generated table must expose the operational routes declared in OpenAPI');
  assert.equal(table.listInstances?.path, '/api/v1/instances', 'the operation the dashboard screen declares must be routable from this table');

  const push = entries.map((entry) => entry.path).filter((p) => /events|stream|subscribe|socket/i.test(p));
  assert.deepEqual(push, [], `the contract now names a push channel (${push.join(', ')}): re-read 11 §4 before this shell ships, because running on poll is the spec's current state and not a preference (D64)`);
  resetShellContextForTests();
});
