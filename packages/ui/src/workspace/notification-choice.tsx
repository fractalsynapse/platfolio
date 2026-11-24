import { WorkspaceMenu } from './workspace-menu.tsx';

export function NotificationChoice<Value extends string>({ label, value, options, onChange }: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
}) {
  const selected = options.find((item) => item.value === value);
  return <div>
    <span className="ui-workspace-meta">{label}</span>
    <WorkspaceMenu label={`${label}, ${selected?.label ?? 'choose an option'}`} trigger={<>{selected?.label ?? 'Choose an option'} <span aria-hidden="true">▾</span></>}>
      {options.map((option) => <button key={option.value} type="button" className="ui-workspace-item ui-hit-primary"
        aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </WorkspaceMenu>
  </div>;
}
