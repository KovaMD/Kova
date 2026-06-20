interface Action { label: string; onClick: () => void; }

interface Props {
  message: string;
  actions?: Action[];
  onDismiss: () => void;
}

export function InfoBanner({ message, actions = [], onDismiss }: Props) {
  return (
    <div style={{
      position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-elevated)', border: '1px solid var(--border-alt)',
      borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.5)', zIndex: 3000,
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12,
      fontSize: 12, color: 'var(--text-secondary)', maxWidth: 560, minWidth: 320,
    }}>
      <span style={{ flex: 1 }}>{message}</span>
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.onClick}
          style={{
            flexShrink: 0, padding: '4px 12px', fontSize: 11, borderRadius: 4,
            border: '1px solid var(--accent)', background: 'var(--accent-bg)',
            color: 'var(--accent)', cursor: 'pointer', fontWeight: 500,
          }}
        >
          {a.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        style={{
          flexShrink: 0, background: 'none', border: 'none', color: 'var(--text-muted)',
          cursor: 'pointer', padding: 4, borderRadius: 4, lineHeight: 1,
          display: 'flex', alignItems: 'center',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12">
          <line x1="1" y1="1" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
