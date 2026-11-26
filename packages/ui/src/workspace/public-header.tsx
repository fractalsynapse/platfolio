import * as React from 'react';
import { BrandLabel } from './brand-label.tsx';
import { workspacePaths } from './routes.ts';

export function PublicHeader({ signIn = false }: { readonly signIn?: boolean }): React.ReactElement {
  return <header className="ui-workspace-header">
    <div className="ui-workspace-header-inner">
      <a className="ui-workspace-wordmark ui-hit-primary" href="/"><BrandLabel /></a>
      {signIn && <a className="ui-workspace-secondary ui-hit-primary" href={workspacePaths.home}>Sign in</a>}
    </div>
  </header>;
}
