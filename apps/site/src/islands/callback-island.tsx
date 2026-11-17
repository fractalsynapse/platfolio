import * as React from 'react';
import { createShellContext } from '@platfolio/ui';
import { endpointsForIsland, runtimeConfigFrom, type SitePublicConfig } from '../lib/site-config.ts';
import { browserCapabilities } from '../lib/browser-capabilities.ts';

/**
 * `/callback`'s one island: it renders nothing, and what it does is the PKCE exchange.
 *
 * The order is the contract, not an implementation detail, and each step refuses the state the step before it
 * could not have produced:
 *
 *  1. `state` is compared against the value written before the redirect, **before** the code is touched. A
 *     mismatch is a refusal, not a retry — that comparison is the whole defence against a code that arrived from
 *     somewhere else, and `packages/ui/test/browser-auth-parity.test.ts` pins it against the script-side flow.
 *  2. The verifier is read once and dropped (`web/browser-auth.ts`'s `complete`). It is the only thing in this app
 *     that survives a navigation, and the policy it is spent against lives in `scripts/browser-auth.ts`: no token
 *     is stored anywhere, so a reload signs in again.
 *  3. Whatever the outcome, the browser leaves. A signed-in person goes to the dashboard; a refused or spent
 *     handoff goes to `/` with the reason in the query, where a person can read it and ask again. `no-handoff` and
 *     `state-mismatch` are different failures and are reported as different words — neither says *which* state it
 *     expected, because that is the value an attacker would get to choose.
 *
 * Nothing is rendered, not even while this is in flight: a page that paints during a redirect is a page whose
 * first paint is a lie about the session, and 11 §8 says a state is only shown with the word for what is known.
 *
 * It calls `createShellContext` for the same reason the dashboard does — one page, one context, and the session
 * established here has to be the one the dashboard reads. Same endpoints, therefore the same memoised object.
 */
export interface CallbackIslandProps {
  readonly config: SitePublicConfig;
}

export default function CallbackIsland(props: CallbackIslandProps): null {
  React.useEffect(() => {
    const shell = createShellContext(endpointsForIsland(props.config, runtimeConfigFrom(globalThis)), browserCapabilities());
    const leave = (target: string): void => {
      globalThis.location.assign(target);
    };

    void (async (): Promise<void> => {
      const params = new URLSearchParams(globalThis.location.search);
      if (params.get('error') !== null) {
        // The issuer answered with its own refusal. Its `error_description` is not forwarded: it is a string from
        // another service, and a page that renders one verbatim is a page that renders attacker-controlled copy.
        leave('/?reason=issuer-refused');
        return;
      }
      const outcome = await shell.auth.complete(params);
      leave(outcome === 'signed-in' ? '/dashboard' : `/?reason=${outcome}`);
    })().catch(() => {
      leave('/?reason=exchange-refused');
    });
  }, [props.config]);

  return null;
}
