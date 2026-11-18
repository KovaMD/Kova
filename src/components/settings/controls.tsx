import type { ChangeEvent, CSSProperties, ReactNode } from 'react';

// ── Shared button group class ─────────────────────────────────────────────────

export function groupBtnClass(active: boolean, extra = ''): string {
  return `settings-group-btn${active ? ' settings-group-btn--active' : ''}${extra ? ` ${extra}` : ''}`;
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`settings-toggle${checked ? ' settings-toggle--on' : ''}`}
    >
      <span className="settings-toggle__knob" />
    </button>
  );
}

// ── Setting row ───────────────────────────────────────────────────────────────

export function Row({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row__label">{label}</div>
        {description && (
          <div className="settings-row__desc">{description}</div>
        )}
      </div>
      {control}
    </div>
  );
}

// ── Select with chevron ───────────────────────────────────────────────────────

export function Select({ value, onChange, style, children }: {
  value: string | number;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  /** Only for data-driven values (e.g. previewing the chosen editor font). */
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="settings-select-wrap">
      <select value={value} onChange={onChange} className="settings-select" style={style}>
        {children}
      </select>
      <svg viewBox="0 0 10 6" className="settings-select__chevron">
        <path d="M0 0l5 6 5-6z" fill="currentColor" />
      </svg>
    </div>
  );
}
