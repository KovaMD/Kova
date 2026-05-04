import type { ThemeColors } from '../../engine/theme';

interface Props {
  colors: ThemeColors;
  onChange: (key: keyof ThemeColors, value: string) => void;
}

const COLOR_FIELDS: Array<{ key: keyof ThemeColors; label: string }> = [
  { key: 'primary',     label: 'Primary' },
  { key: 'accent',      label: 'Accent' },
  { key: 'background',  label: 'Background' },
  { key: 'text',        label: 'Text' },
  { key: 'title_text',  label: 'Title text' },
  { key: 'section_bg',  label: 'Section bg' },
  { key: 'code_bg',     label: 'Code bg' },
];

export function ColorControls({ colors, onChange }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {COLOR_FIELDS.map(({ key, label }) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label
            htmlFor={`color-${key}`}
            style={{ fontSize: 11, color: '#888', flex: 1, cursor: 'pointer' }}
          >
            {label}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              id={`color-${key}`}
              type="color"
              value={colors[key]}
              onChange={(e) => onChange(key, e.target.value)}
              style={{
                width: 26,
                height: 20,
                padding: 1,
                border: '1px solid #444',
                borderRadius: 3,
                background: 'none',
                cursor: 'pointer',
              }}
            />
            <span style={{ fontSize: 10, color: '#666', fontFamily: 'monospace', width: 52 }}>
              {colors[key]}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
