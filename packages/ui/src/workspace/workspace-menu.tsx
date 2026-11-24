import * as React from 'react';

interface WorkspaceMenuProps {
  readonly label: string;
  readonly trigger: React.ReactNode;
  readonly children: React.ReactNode;
  readonly align?: 'end';
  readonly hover?: boolean;
}

/** A disclosure contains ordinary links, so Tab works without a menu-role keyboard model. */
export function WorkspaceMenu({ label, trigger, children, align, hover }: WorkspaceMenuProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  const pinned = React.useRef(false);
  const pointerInside = React.useRef(false);
  const close = () => { pinned.current = false; setOpen(false); };

  return <div className="ui-workspace-menu"
    onBlur={(event) => {
      // Some pointer clicks blur the trigger without focusing the clicked action before it runs.
      if (!event.currentTarget.contains(event.relatedTarget) && (event.relatedTarget || !pointerInside.current)) close();
    }}
    onPointerEnter={(event) => {
      pointerInside.current = true;
      if (hover && event.pointerType === 'mouse') setOpen(true);
    }}
    onPointerLeave={(event) => {
      pointerInside.current = false;
      if (hover && event.pointerType === 'mouse' && !pinned.current && !event.currentTarget.matches(':focus-within')) close();
    }}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        close();
        button.current?.focus();
      }
    }}>
    <button aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} className="ui-workspace-trigger ui-hit-primary" ref={button}
      type="button" onClick={() => { if (pinned.current) close(); else { pinned.current = true; setOpen(true); } }}>
      {trigger}
    </button>
    {open && <div id={id} className={align === 'end' ? 'ui-workspace-popover ui-workspace-popover-end' : 'ui-workspace-popover'}
      onClick={(event) => { if (event.target instanceof Element && event.target.closest('a, button')) close(); }}>
      {children}
    </div>}
  </div>;
}
