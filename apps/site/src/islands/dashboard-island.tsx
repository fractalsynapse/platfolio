import { useEffect, useMemo, useRef, useState } from 'react';
import { Workspace, WorkspaceEntry, createShellContext, workspacePaths, workspaceReturnPath } from '@platfolio/ui';
import { endpointsForIsland, runtimeConfigFrom, type SitePublicConfig } from '../lib/site-config.ts';
import { browserCapabilities } from '../lib/browser-capabilities.ts';

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
    void shell.auth.complete(params, (destination) => {
      globalThis.history.replaceState(null, '', destination);
      setPathname(destination);
    }).then((status) => {
      if (status === 'signed-in') setSignedIn(true);
      else setProblem('Sign-in could not finish. Try again.');
    }).catch(() => setProblem('Sign-in could not finish. Try again.')).finally(() => setCompleting(false));
  }, [shell, callback]);

  const begin = () => {
    if (beginning) return;
    setProblem('');
    setBeginning(true);
    const target = workspaceReturnPath(pathname) ?? workspacePaths.home;
    void shell.auth.begin(target).then((url) => globalThis.location.assign(url))
      .catch(() => { setBeginning(false); setProblem('Sign-in could not start. Try again.'); });
  };

  if (!signedIn) return <WorkspaceEntry begin={begin} completing={completing} beginning={beginning} problem={problem} />;

  const navigate = (path: string) => {
    if (path === pathname || !workspaceReturnPath(path)) return;
    globalThis.history.pushState(null, '', path);
    setPathname(path);
    globalThis.scrollTo(0, 0);
  };
  const signOut = () => globalThis.location.assign(shell.auth.signOut() ?? '/');
  return shell.wrap(<Workspace pathname={pathname} navigate={navigate} signIn={begin} signOut={signOut} />);
}
