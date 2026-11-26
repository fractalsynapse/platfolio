import * as React from 'react';

export function WorkspaceDialog({ title, onCancel, children }: {
  readonly title: string;
  readonly onCancel: () => void;
  readonly children: React.ReactNode;
}): React.ReactElement {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const heading = React.useId();
  React.useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = element.ownerDocument.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog className="ui-workspace-panel ui-workspace-dialog" ref={dialog} aria-labelledby={heading}
    onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id={heading}>{title}</h2>
    {children}
  </dialog>;
}
