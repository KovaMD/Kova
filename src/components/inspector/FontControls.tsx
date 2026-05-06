import { useEffect, useId, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ThemeFonts } from '../../engine/theme';

interface Props {
  fonts: ThemeFonts;
  onChange: (key: keyof ThemeFonts, value: string) => void;
}

const FONT_FIELDS: Array<{ key: keyof ThemeFonts; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'body',  label: 'Body' },
  { key: 'code',  label: 'Code' },
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#2a2a2a',
  color: '#ccc',
  border: '1px solid #444',
  borderRadius: 4,
  padding: '3px 6px',
  fontSize: 11,
  boxSizing: 'border-box',
};

export function FontControls({ fonts, onChange }: Props) {
  const listId = useId();
  const [systemFonts, setSystemFonts] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>('list_system_fonts')
      .then(setSystemFonts)
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <datalist id={listId}>
        {systemFonts.map((f) => <option key={f} value={f} />)}
      </datalist>

      {FONT_FIELDS.map(({ key, label }) => (
        <div key={key}>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>
            {label}
          </label>
          <input
            list={listId}
            style={inputStyle}
            value={fonts[key]}
            onChange={(e) => onChange(key, e.target.value)}
            spellCheck={false}
            placeholder="Font name or stack…"
          />
        </div>
      ))}

      {systemFonts.length > 0 && (
        <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
          {systemFonts.length} fonts available
        </div>
      )}
    </div>
  );
}
