import type { CSSProperties, ReactNode } from 'react';

// ── Shared button group style ─────────────────────────────────────────────────

export function groupBtnStyle(active: boolean): CSSProperties {
  return {
    flex: 1, padding: '5px 0', fontSize: 11, borderRadius: 4,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-alt)'}`,
    background: active ? 'var(--accent-bg)' : 'var(--bg-input)',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    cursor: 'pointer', fontWeight: active ? 600 : 400, transition: 'all 0.12s',
  };
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        flexShrink: 0,
        position: 'relative',
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: checked ? 'var(--accent)' : 'var(--btn-border)',
        cursor: 'pointer',
        transition: 'background 0.18s',
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3,
        left: checked ? 19 : 3,
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.18s',
        display: 'block',
      }} />
    </button>
  );
}

// ── Setting row ───────────────────────────────────────────────────────────────

export function Row({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0' }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>{label}</div>
        {description && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{description}</div>
        )}
      </div>
      {control}
    </div>
  );
}
