import * as React from 'react';
import { InstanceListScreen, StarterLaunchScreen, createShellContext } from '@platfolio/ui';
import { endpointsForIsland, runtimeConfigFrom, type SitePublicConfig } from '../lib/site-config.ts';
import { browserCapabilities } from '../lib/browser-capabilities.ts';

/**
 * The dashboard: D65's one React island.
 *
 * ## What this component is allowed to be
 *
 * A *container*, and the smallest one the SDK seam accepts. It builds the page context once — through
 * `createShellContext`, memoised on its configuration and refusing a second, different one (see
 * `packages/ui/src/web/shell.tsx`) — wraps its child in the one SDK context and the one signal registry, and
 * renders `InstanceListScreen`, a screen *document* resolved through the build-time registry
 * (`packages/ui/src/screens/instance-list.tsx`; 11 §2 acceptance (d) is what makes that composition data rather
 * than JSX). Everything it does not do is the point:
 *
 *  - **No data path of its own.** No `fetch`, no URL, no operation id typed out. `InstanceListScreen` reaches the
 *    control plane through `useOperation`, over the transport that routes from the generated `ENDPOINTS` table
 *    (#258). Gate §D65 reads this file for exactly that reason; the site's only `fetch` lives in
 *    `lib/browser-capabilities.ts`, where it can address nothing but the issuer's token endpoint.
 *  - **No clock of its own.** The instant comes off `shell.sdk.now` — the same `() => Date` that stamps
 *    `observedAt` on every answer (11 §6 rule 3), so a label and the observation it describes cannot disagree.
 *    `useClock()` is the hook form of the same fact and requires the provider, which is why the value is read from
 *    the context this page just built rather than by calling the hook outside `shell.wrap`.
 *  - **No second freshness story, and no claim of a push channel.** `freshness` travels with each result and
 *    `InstanceListScreen` hands it to `freshness.label`, which says "updated 4s ago (polled)" through
 *    `transportWord` — the only spelling of that parenthetical. D64 made real-time a required capability while
 *    11 §9.10 and gate §R5 refuse the vocabulary until the push operations exist in
 *    `apps/control-plane/openapi.yaml`; this change adds none, and the §D65 rule re-measures that over this app.
 *  - The sign-in callback uses the same island and updates the URL without a page reload, preserving the
 *    in-memory session from the PKCE exchange.
 *
 * ## Why the page mounts this `client:only`, and what that costs
 *
 * `InstanceListScreen` reads a clock during render. Server-rendered and then hydrated, one props object answers
 * two different instants — the prerender stamps one time, hydration stamps a later one, and React calls that a
 * mismatch that the browser has to repair. So `src/pages/dashboard.astro` mounts this island `client:only`: the
 * *page* is still prerendered (Astro emits its heading, its token-driven stylesheet and the island placeholder at
 * build), and what is not prerendered is the part that asks the API and reads a clock — which is the half that
 * cannot be answered before a session exists anyway. The honest consequence, measured rather than asserted:
 * `/dashboard`'s emitted HTML contains the island element and no instance rows, and the zero-JS claim belongs to
 * `/`, where `test/build-output.test.ts` tests it.
 */
export interface DashboardIslandProps {
  readonly config: SitePublicConfig;
  readonly callback?: boolean;
}

export default function DashboardIsland(props: DashboardIslandProps): React.ReactElement {
  // The one context, from the one call site in this app. `useMemo` keeps a re-render from re-asking; the
  // memoisation inside `createShellContext` is what makes the same question idempotent if this line ever changes.
  const shell = React.useMemo(
    () => createShellContext(endpointsForIsland(props.config, runtimeConfigFrom(globalThis)), browserCapabilities()),
    [props.config],
  );

  const [signedIn, setSignedIn] = React.useState(() => shell.auth.signedIn());
  const [showInstances, setShowInstances] = React.useState(false);
  const [problem, setProblem] = React.useState('');
  const exchanged = React.useRef(false);
  React.useEffect(() => {
    if (!props.callback || exchanged.current) return;
    exchanged.current = true;
    const params = new URLSearchParams(globalThis.location.search);
    void shell.auth.complete(params).then((status) => {
      if (status !== 'signed-in') { setProblem('Sign-in could not finish. Start again.'); return; }
      globalThis.history.replaceState(null, '', '/dashboard');
      setSignedIn(true);
    }).catch(() => setProblem('Sign-in could not finish. Start again.'));
  }, [shell, props.callback]);
  if (!signedIn) return <>
    {problem && <p role="alert">{problem}</p>}
    {props.callback && !problem ? <p role="status">Completing sign-in…</p>
      : <button type="button" className="ui-hit-primary" onClick={() => {
        void shell.auth.begin().then((target) => globalThis.location.assign(target))
          .catch(() => setProblem('Sign-in could not start. Try again.'));
      }}>Sign in</button>}
  </>;
  return shell.wrap(<>
    <nav aria-label="Dashboard"><button type="button" className="ui-hit-primary" onClick={() => setShowInstances(!showInstances)}>{showInstances ? 'Set up starter app' : 'View instances'}</button></nav>
    {showInstances ? <InstanceListScreen now={shell.sdk.now().toISOString()} /> : <StarterLaunchScreen />}
  </>);
}
