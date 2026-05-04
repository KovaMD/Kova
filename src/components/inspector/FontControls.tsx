import type { ThemeFonts } from '../../engine/theme';

interface Props {
  fonts: ThemeFonts;
  onChange: (key: keyof ThemeFonts, value: string) => void;
}

const FONT_OPTIONS = [
  'Inter, Helvetica Neue, Arial, sans-serif',
  'Georgia, Times New Roman, serif',
  'Arial, Helvetica, sans-serif',
  'Verdana, Geneva, sans-serif',
  'Charter, Georgia, serif',
  'JetBrains Mono, Fira Code, monospace',
  'Menlo, Monaco, Consolas, monospace',
  'Courier New, Courier, monospace',
];

const FONT_FIELDS: Array<{ key: keyof ThemeFonts; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'body',  label: 'Body' },
  { key: 'code',  label: 'Code' },
];

export function FontControls({ fonts, onChange }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {FONT_FIELDS.map(({ key, label }) => (
        <div key={key}>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>
            {label}
          </label>
          <select
            value={fonts[key]}
            onChange={(e) => onChange(key, e.target.value)}
            style={{
              width: '100%',
              background: '#2a2a2a',
              color: '#ccc',
              border: '1px solid #444',
              borderRadius: 4,
              padding: '3px 6px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            {/* Keep current value if not in list */}
            {!FONT_OPTIONS.includes(fonts[key]) && (
              <option value={fonts[key]}>{shortFontName(fonts[key])}</option>
            )}
            {FONT_OPTIONS.map((f) => (
              <option key={f} value={f}>{shortFontName(f)}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function shortFontName(stack: string): string {
  return stack.split(',')[0].trim().replace(/['"]/g, '');
}
