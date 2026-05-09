import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ThemeFonts } from '../../engine/theme';

interface Props {
  fonts: ThemeFonts;
  onChange: (key: keyof ThemeFonts, value: string) => void;
}

interface FontOption { label: string; value: string }

const SANS: FontOption[] = [
  { label: 'Inter',           value: 'Inter, Helvetica Neue, Arial, sans-serif' },
  { label: 'Helvetica Neue',  value: 'Helvetica Neue, Arial, sans-serif' },
  { label: 'Arial',           value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana',         value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS',    value: 'Trebuchet MS, Helvetica, sans-serif' },
];

const SERIF: FontOption[] = [
  { label: 'Georgia',         value: 'Georgia, Times New Roman, serif' },
  { label: 'Charter',         value: 'Charter, Georgia, serif' },
  { label: 'Palatino',        value: 'Palatino Linotype, Book Antiqua, Palatino, serif' },
  { label: 'Times New Roman', value: 'Times New Roman, Times, serif' },
];

const MONO: FontOption[] = [
  { label: 'JetBrains Mono',  value: 'JetBrains Mono, Fira Code, Cascadia Code, monospace' },
  { label: 'Fira Code',       value: 'Fira Code, JetBrains Mono, monospace' },
  { label: 'Cascadia Code',   value: 'Cascadia Code, Consolas, monospace' },
  { label: 'Menlo',           value: 'Menlo, Monaco, Consolas, monospace' },
  { label: 'Courier New',     value: 'Courier New, Courier, monospace' },
];

const CURATED: Record<keyof ThemeFonts, FontOption[]> = {
  title: [...SANS, ...SERIF],
  body:  [...SANS, ...SERIF],
  code:  MONO,
};

const FONT_FIELDS: Array<{ key: keyof ThemeFonts; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'body',  label: 'Body' },
  { key: 'code',  label: 'Code' },
];

// ── Custom dropdown ───────────────────────────────────────────────────────────

interface Group { label: string; options: FontOption[] }

function FontSelect({ value, groups, onChange }: {
  value: string;
  groups: Group[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const allOptions = groups.flatMap((g) => g.options);
  const display = allOptions.find((o) => o.value === value)?.label ?? value.split(',')[0].trim();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-input)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-input)',
          borderRadius: 4,
          padding: '4px 8px',
          fontSize: 11,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {display}
        </span>
        <svg width="8" height="5" viewBox="0 0 8 5" style={{ flexShrink: 0, marginLeft: 4, opacity: 0.5 }}>
          <path d="M0 0l4 5 4-5z" fill="currentColor" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 9999,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-input)',
          borderRadius: 4,
          marginTop: 2,
          maxHeight: 220,
          overflowY: 'auto',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}>
          {groups.map((group) => (
            <div key={group.label}>
              <div style={{
                padding: '5px 8px 2px',
                fontSize: 10,
                color: 'var(--text-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                userSelect: 'none',
              }}>
                {group.label}
              </div>
              {group.options.map((opt) => (
                <div
                  key={opt.value}
                  onMouseDown={() => { onChange(opt.value); setOpen(false); }}
                  style={{
                    padding: '5px 12px',
                    fontSize: 11,
                    color: opt.value === value ? 'var(--accent)' : 'var(--text-primary)',
                    background: 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  {opt.label}
                  {opt.value === value && (
                    <svg width="10" height="8" viewBox="0 0 10 8">
                      <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function FontControls({ fonts, onChange }: Props) {
  const [systemFonts, setSystemFonts] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>('list_system_fonts')
      .then(setSystemFonts)
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {FONT_FIELDS.map(({ key, label }) => {
        const curated = CURATED[key];
        const curatedValues = new Set(curated.map((o) => o.value));
        const current = fonts[key];
        const isCustom = current && !curatedValues.has(current) && !systemFonts.includes(current);

        const groups: Group[] = [];
        if (isCustom) groups.push({ label: 'Current', options: [{ label: current.split(',')[0].trim(), value: current }] });
        groups.push({ label: 'Common', options: curated });
        if (systemFonts.length > 0) {
          groups.push({
            label: 'System Fonts',
            options: systemFonts.map((f) => ({ label: f, value: f })),
          });
        }

        return (
          <div key={key}>
            <label style={{ fontSize: 11, color: 'var(--text-label)', display: 'block', marginBottom: 3 }}>
              {label}
            </label>
            <FontSelect value={current} groups={groups} onChange={(v) => onChange(key, v)} />
          </div>
        );
      })}
    </div>
  );
}
