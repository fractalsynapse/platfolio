import * as React from 'react';

/** A `dt`/`dd` pair, so the label text is the only thing a field contributes and it always comes from a schema. */
export function Field(props: { readonly label: string; readonly children?: React.ReactNode }): React.ReactElement {
  return (
    <div className="ui-field">
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}
