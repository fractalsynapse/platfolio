import * as React from 'react';

export function WorkspaceAvatar({ name, imageUrl, limit = 2 }: {
  readonly name?: string | undefined;
  readonly imageUrl?: string | undefined;
  readonly limit?: 1 | 2;
}): React.ReactElement {
  const initials = name?.trim().split(/\s+/).slice(0, limit).map((word) => Array.from(word)[0]).join('').toUpperCase();
  const [failedImage, setFailedImage] = React.useState<string>();
  return <span className="ui-workspace-avatar" aria-hidden="true">
    {imageUrl && failedImage !== imageUrl
      ? <img src={imageUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedImage(imageUrl)} />
      : initials || <><span className="ui-workspace-avatar-head" /><span className="ui-workspace-avatar-body" /></>}
  </span>;
}
