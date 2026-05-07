import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type MenuEntry =
  | { type: 'item'; label: string; shortcut?: string; action: () => void; disabled?: boolean }
  | { type: 'divider' }
  | { type: 'header'; label: string };

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  entries: MenuEntry[];
}

export function EditorContextMenu({ x, y, onClose, entries }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  const cx = Math.min(x, window.innerWidth - 215);
  // Start at the raw y; useLayoutEffect corrects before paint if the menu would clip
  const [cy, setCy] = useState(y);
  useLayoutEffect(() => {
    if (ref.current) {
      const h = ref.current.offsetHeight;
      setCy(Math.min(y, window.innerHeight - h - 8));
    }
  }, [y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: cx,
        top: cy,
        background: '#252525',
        border: '1px solid #3a3a3a',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 205,
        zIndex: 9999,
        boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
        fontSize: 13,
        color: '#ccc',
        userSelect: 'none',
      }}
    >
      {entries.map((entry, i) => {
        if (entry.type === 'divider') {
          return <div key={i} style={{ height: 1, background: '#333', margin: '4px 0' }} />;
        }
        if (entry.type === 'header') {
          return (
            <div
              key={i}
              style={{
                padding: '5px 14px 2px',
                fontSize: 10,
                color: '#555',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {entry.label}
            </div>
          );
        }
        return (
          <div
            key={i}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!entry.disabled) { entry.action(); onClose(); }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '5px 14px',
              margin: '0 4px',
              borderRadius: 3,
              cursor: entry.disabled ? 'default' : 'pointer',
              opacity: entry.disabled ? 0.35 : 1,
            }}
            onMouseEnter={(e) => {
              if (!entry.disabled)
                (e.currentTarget as HTMLDivElement).style.background = '#333';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.background = 'transparent';
            }}
          >
            <span>{entry.label}</span>
            {entry.shortcut && (
              <span style={{ color: '#555', fontSize: 11, marginLeft: 24 }}>{entry.shortcut}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export type { MenuEntry };
