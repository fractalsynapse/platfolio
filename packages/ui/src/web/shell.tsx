import * as React from 'react';
import { createSignalBus } from '../signals.ts';
import { PollTransport } from '../sdk/poll.ts';
import { SdkContext, type SdkContextValue } from '../sdk/use-operation.ts';
import { SignalsContext } from '../signals-context.ts';
import { LOGIN_SCOPES, WEB_CLIENT_ID } from './browser-auth-policy.ts';
import type { SignalBus } from '../signals.ts';
import type { Transport } from '../sdk/transport.ts';
import {
  createBrowserAuthSource,
  type BrowserAuthSource,
  type Digest,
  type HandoffStore,
  type IssuerRequest,
  type RandomBytes,
  type BrowserAuthConfig,
} from './browser-auth.ts';

/**
 * The one place a platfolio web page builds an SDK context and a signal registry (D65).
 *
 * ## The risk this file closes
 *
 * D65 decides the shell is Astro and the dashboard is one React island inside it, and names the cost in the same
 * sentence: *"the island constructs the SDK context and the signal registry **exactly once**, because a second
 * hydration means two registries and two token stores."* Two `SdkContextValue` objects means two `PollTransport`
 * instances — two freshness clocks, so one panel saying "4s ago" beside another saying "90s ago" about the same
 * operation. Two `SignalBus` objects means a context switch emitted into one and listened for on the other, which
 * is the silent half of the failure: nothing throws, the UI simply stops agreeing with itself. Two token bags
 * means two refresh schedules for one session, which is how a refresh becomes a 401 nobody can explain.
 *
 * ## What "exactly once" is enforced over, and what it is not
 *
 * `createShellContext` is memoised on the configuration it was first given, and a call carrying a **different**
 * configuration throws. That is the failure that actually happens: a page that mounts the island twice with its
 * own environment block, or a second island that constructs its own context. Both arrive here as two calls with
 * two fingerprints, and the second is refused by name. Two calls with the *same* configuration return the same
 * object, so a double hydration is harmless rather than a second registry — idempotence is what makes the mistake
 * survivable, and the refusal is what makes it visible. Proved by
 * `packages/ui/test/shell-context-singleton.test.ts`, which runs this module in Node with no DOM involved.
 *
 * What this does **not** claim: that `SdkProvider`, `SignalsProvider`, `PollTransport` and `createSignalBus`
 * cannot be called directly — they are exported, and a native shell (UI-OD3) will build its own. The gate that
 * holds the *site* to D65 is `scripts/check-ui.ts` §D65, which reads the site's sources and its built output:
 * at most one island element per page, the page that hydrates must reach the API only through the one SDK, and
 * every `createShellContext` call site must sit in a page file.
 *
 * ## Why the capabilities are injected
 *
 * The endpoints arrive as data (D47). The four capabilities a browser owns — requester, digest, entropy,
 * handoff store — arrive as functions from the shell, because 11 §9.2 refuses `fetch(` anywhere in this package
 * outside `sdk/poll.ts`, and `navigator`/`crypto` are browser surfaces this boundary keeps to `web/`. So the flow
 * is described here and the sockets stay with the browser that opens them.
 */

export interface ShellEndpoints {
  /** The control plane's base URL. Required, and never a literal in this package (D47). */
  readonly apiBaseUrl: string;
  /** The realm URL the browser authenticates against, e.g. `https://<issuer>/realms/<realm>`. */
  readonly issuerBaseUrl: string;
  /** This site's own origin, so `CALLBACK_PATH` stays one spelling. */
  readonly siteOrigin: string;
  /** Defaults to the policy's `platfolio-web`; a deploy that renamed its client supplies a name, not a fork. */
  readonly clientId?: string;
  readonly scope?: string;
}

export interface ShellCapabilities {
  readonly request: IssuerRequest;
  readonly digest: Digest;
  readonly random: RandomBytes;
  readonly handoff: HandoffStore;
  readonly now?: () => number;
}

export interface ShellContext {
  /** What `SdkProvider` consumes. One object per page, because one transport means one freshness clock. */
  readonly sdk: SdkContextValue;
  /** What `SignalsProvider` consumes. One bus per page, because a replayed signal reaches one registry. */
  readonly signals: SignalBus;
  readonly auth: BrowserAuthSource;
  readonly transport: Transport;
  readonly endpoints: ShellEndpoints;
  /**
   * The two React contexts, in the order a page should nest them, with the island as the leaf.
   *
   * A page is not supposed to know that four modules stand behind this. `renderScreen` reads whatever providers
   * wrap it, so the island's whole job is to hand down the one pair created here.
   */
  readonly wrap: (children: React.ReactNode) => React.ReactElement;
}

/**
 * Every context handed out, keyed by the configuration that produced it.
 *
 * A `Map`, not a single slot: the same configuration asked for twice must return the same object, and a second
 * *different* configuration is the violation. The key is the fingerprint of the endpoints, the narrowest thing
 * that separates "this page mounted twice" from "two pages that disagree about where the API lives".
 */
const created = new Map<string, ShellContext>();

export class ShellContextConflict extends Error {
  constructor(first: string, second: string) {
    super(
      `createShellContext was called twice with different configuration (${first} then ${second}). `
      + 'D65: a second hydration means two registries and two token stores, so the second one is refused here. '
      + 'One island per page, and one set of endpoints per document.',
    );
    this.name = 'ShellContextConflict';
  }
}

const fingerprintOf = (endpoints: ShellEndpoints): string => [
  endpoints.apiBaseUrl,
  endpoints.issuerBaseUrl,
  endpoints.siteOrigin,
  endpoints.clientId ?? WEB_CLIENT_ID,
  endpoints.scope ?? LOGIN_SCOPES,
].join('\u0000');

/** The named endpoint in the conflict message: the origin, never the whole table, and never a token (D4). */
const describe = (endpoints: ShellEndpoints): string =>
  `${endpoints.siteOrigin} -> ${endpoints.apiBaseUrl} @ ${endpoints.issuerBaseUrl}`;

/**
 * Build — or return the already-built — page context.
 *
 * The transport gets `baseUrl` and nothing about routes: `PollTransportConfig.endpoints` defaults to the
 * generated `ENDPOINTS` table (#258), so a shell that hand-supplies a route table would be a second source of
 * truth about the API's shape. That is why no `endpoints` field appears on `ShellEndpoints`.
 */
export function createShellContext(endpoints: ShellEndpoints, capabilities: ShellCapabilities): ShellContext {
  const key = fingerprintOf(endpoints);
  const existing = created.get(key);
  if (existing !== undefined) return existing;
  if (created.size > 0) {
    const first = [...created.values()][0];
    throw new ShellContextConflict(first === undefined ? '(unknown)' : describe(first.endpoints), describe(endpoints));
  }

  // `exactOptionalPropertyTypes` is the reason these two lines are not one object literal with two `??`
  // expressions: `BrowserAuthConfig.clientId?: string` does not accept an explicit `undefined`, and a shell that
  // passes one has said "no client id" in a way the type cannot distinguish from "not mentioned". Omitting the
  // key is the honest spelling, and the default the omitted key produces is the policy's own `platfolio-web`.
  const authConfig: BrowserAuthConfig = {
    issuerBaseUrl: endpoints.issuerBaseUrl,
    siteOrigin: endpoints.siteOrigin,
    ...(endpoints.clientId === undefined ? {} : { clientId: endpoints.clientId }),
    ...(endpoints.scope === undefined ? {} : { scope: endpoints.scope }),
  };
  const auth = createBrowserAuthSource(authConfig, {
    request: capabilities.request,
    digest: capabilities.digest,
    random: capabilities.random,
    handoff: capabilities.handoff,
    ...(capabilities.now === undefined ? {} : { now: capabilities.now }),
  });
  const transport = new PollTransport({ baseUrl: endpoints.apiBaseUrl });
  const signals = createSignalBus();
  const sdk: SdkContextValue = { transport, auth, now: () => new Date() };

  const context: ShellContext = {
    sdk,
    signals,
    auth,
    transport,
    endpoints,
    wrap: (children) =>
      React.createElement(
        SdkContext.Provider,
        { value: sdk },
        React.createElement(SignalsContext.Provider, { value: signals }, children),
      ),
  };
  created.set(key, context);
  return context;
}

/** How many page contexts exist. A gate and a test read this instead of trusting the comment above. */
export const shellContextCount = (): number => created.size;

/**
 * Forget the built context. **Test-only**, and named so a page cannot reach for it by accident: a page that
 * resets the singleton in production is a page with two registries and no way to notice.
 */
export function resetShellContextForTests(): void {
  created.clear();
}
