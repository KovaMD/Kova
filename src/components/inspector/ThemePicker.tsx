import type { Theme } from '../../engine/theme';

interface Props {
  themes: Theme[];
  activeId: string;
  onSelect: (id: string) => void;
}

export function ThemePicker({ themes, activeId, onSelect }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {themes.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 8px',
            background: t.id === activeId ? '#2e2e2e' : 'transparent',
            border: `1px solid ${t.id === activeId ? '#D94F00' : '#333'}`,
            borderRadius: 4,
            cursor: 'pointer',
            color: '#ccc',
            fontSize: 12,
            textAlign: 'left',
            width: '100%',
          }}
        >
          {/* Mini colour swatch */}
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            <Swatch color={t.colors.primary} />
            <Swatch color={t.colors.background} border />
            <Swatch color={t.colors.accent} />
          </div>
          <span style={{ flex: 1 }}>{t.name}</span>
          {t.id === activeId && (
            <span style={{ color: '#D94F00', fontSize: 10 }}>✓</span>
          )}
        </button>
      ))}
    </div>
  );
}

function Swatch({ color, border }: { color: string; border?: boolean }) {
  return (
    <div
      style={{
        width: 12,
        height: 12,
        borderRadius: 2,
        background: color,
        border: border ? '1px solid #555' : 'none',
        flexShrink: 0,
      }}
    />
  );
}
