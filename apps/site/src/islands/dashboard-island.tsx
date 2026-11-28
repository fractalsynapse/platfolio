import { useEffect, useMemo, useRef, useState } from 'react';
import { PrivateSetupGate, Workspace, WorkspaceEntry, createShellContext, isHubSignInCallback, workspacePaths, workspaceReturnPath } from '@platfolio/ui';
import { endpointsForIsland, runtimeConfigFrom, type SitePublicConfig } from '../lib/site-config.ts';
import { browserCapabilities } from '../lib/browser-capabilities.ts';
import type { HubSignIn, ShellContext } from '@platfolio/ui';

async function discoverHub(shell: ShellContext): Promise<HubSignIn | undefined> {
  const result = await shell.transport.call('getHubSignIn', { params: {} });
  if (result.ok && result.value.enabled && result.value.issuer && result.value.clientId && result.value.scope) {
    const { issuer, clientId, scope } = result.value;
    return { issuer, clientId, scope };
  }
}

interface DashboardIslandProps {
  readonly config: SitePublicConfig;
  readonly callback?: boolean;
}

export default function DashboardIsland({ config, callback }: DashboardIslandProps) {
  const shell = useMemo(() => createShellContext(endpointsForIsland(config, runtimeConfigFrom(globalThis)), browserCapabilities()), [config]);
  const [pathname, setPathname] = useState(() => globalThis.location.pathname);
  const [signedIn, setSignedIn] = useState(() => shell.auth.signedIn());
  const [problem, setProblem] = useState('');
  const [completing, setCompleting] = useState(callback === true);
  const [beginning, setBeginning] = useState(false);
  const exchanged = useRef(false);
  const [hub, setHub] = useState<HubSignIn>();

  useEffect(() => {
    if (signedIn || completing) return;
    let current = true;
    void discoverHub(shell).then((option) => { if (current) setHub(option); }).catch(() => {});
    return () => { current = false; };
  }, [shell, signedIn, completing]);

  useEffect(() => {
    const restore = () => setPathname(globalThis.location.pathname);
    globalThis.addEventListener('popstate', restore);
    return () => globalThis.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (!callback || exchanged.current) return;
    exchanged.current = true;
    const params = new URLSearchParams(globalThis.location.search);
    if (params.size === 0) {
      globalThis.history.replaceState(null, '', workspacePaths.home);
      setPathname(workspacePaths.home);
      setCompleting(false);
      return;
    }
    void (async () => {
      const hubCallback = isHubSignInCallback(params);
      const option = hubCallback ? await discoverHub(shell) : undefined;
      let destination: string = workspacePaths.home;
      const status = await shell.auth.complete(params, path => { destination = path; }, option);
      globalThis.history.replaceState(null, '', destination);
      setPathname(destination);
      if (status !== 'signed-in') {
        setProblem('Sign-in could not finish. Try again.');
        return;
      }
      if (hubCallback && !(await shell.transport.call('getCurrentPerson', { params: {} }, shell.auth)).ok) {
        shell.auth.signOut();
        setProblem('This hub account has no private access. Sign in with your private account.');
        return;
      }
      setSignedIn(true);
    })().catch(() => {
      globalThis.history.replaceState(null, '', workspacePaths.home);
      setPathname(workspacePaths.home);
      setProblem('Sign-in could not finish. Try again.');
    }).finally(() => setCompleting(false));
  }, [shell, callback]);

  const beginSignIn = (provider?: HubSignIn) => {
    if (beginning) return;
    setProblem('');
    setBeginning(true);
    const target = workspaceReturnPath(pathname) ?? workspacePaths.home;
    void shell.auth.begin(target, undefined, provider).then((url) => globalThis.location.assign(url))
      .catch(() => { setBeginning(false); setProblem('Sign-in could not start. Try again.'); });
  };

  const begin = () => beginSignIn();
  if (!signedIn) return <WorkspaceEntry begin={begin} completing={completing} beginning={beginning} problem={problem}
    {...(hub ? { beginHub: () => beginSignIn(hub) } : {})} />;

  const navigate = (path: string) => {
    if (path === pathname || !workspaceReturnPath(path)) return;
    globalThis.history.pushState(null, '', path);
    setPathname(path);
    globalThis.scrollTo(0, 0);
  };
  const signOut = () => globalThis.location.assign(shell.auth.signOut() ?? '/');
  const changePassword = async () => globalThis.location.assign(await shell.auth.begin(workspacePaths.accountPassword, 'UPDATE_PASSWORD'));
  return shell.wrap(<PrivateSetupGate><Workspace pathname={pathname} navigate={navigate} signIn={begin} signOut={signOut} changePassword={changePassword} /></PrivateSetupGate>);
}
