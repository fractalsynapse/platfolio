import * as React from 'react';
import { BrandLabel } from './brand-label.tsx';

export function PublicHeader({ signIn = false }: { readonly signIn?: boolean }): React.ReactElement {
  return <header className="ui-workspace-header">
    <div className="ui-workspace-header-inner">
      <a className="ui-workspace-wordmark ui-hit-primary" href="/"><BrandLabel /></a>
      {signIn && <a className="ui-workspace-secondary ui-hit-primary" href="/sign-in">Sign in</a>}
    </div>
  </header>;
}
