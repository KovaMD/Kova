import { useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Theme } from '../../engine/theme';

interface Props {
  logo: string | undefined;
  logoPosition: Theme['logo_position'];
  logoOpacity: number;
  header: Theme['header'];
  footer: Theme['footer'];
  onLogoChange: (path: string | undefined) => void;
  onLogoPositionChange: (pos: Theme['logo_position']) => void;
  onLogoOpacityChange: (opacity: number) => void;
  onHeaderChange: (header: Theme['header']) => void;
  onFooterChange: (footer: Theme['footer']) => void;
}

const POSITIONS: Array<{ value: Theme['logo_position']; label: string }> = [
  { value: 'top-left',     label: 'Top left' },
  { value: 'top-right',    label: 'Top right' },
  { value: 'bottom-left',  label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
];

export function LogoControls({
  logo, logoPosition, logoOpacity, header, footer,
  onLogoChange, onLogoPositionChange, onLogoOpacityChange, onHeaderChange, onFooterChange,
}: Props) {
  const pickLogo = useCallback(async () => {
    const selected = await open({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'gif'] }],
      multiple: false,
    });
    if (selected && typeof selected === 'string') {
      onLogoChange(convertFileSrc(selected));
    }
  }, [onLogoChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Logo */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-label)', marginBottom: 4 }}>Logo</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {logo && (
            <img src={logo} alt="logo preview"
              style={{ height: 24, width: 'auto', borderRadius: 2, border: '1px solid var(--border-input)' }} />
          )}
          <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={pickLogo}>
            {logo ? 'Change' : 'Choose…'}
          </button>
          {logo && (
            <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => onLogoChange(undefined)}>
              Remove
            </button>
          )}
        </div>
        {logo && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, marginTop: 6 }}>
              {POSITIONS.map((p) => {
                const active = logoPosition === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => onLogoPositionChange(p.value)}
                    style={{
                      padding: '4px 0',
                      fontSize: 11,
                      borderRadius: 3,
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--btn-border)'}`,
                      background: active ? 'var(--accent-bg)' : 'var(--bg-input)',
                      color: active ? 'var(--accent)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontWeight: active ? 600 : 400,
                      transition: 'all 0.12s',
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-label)' }}>Opacity</span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(logoOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(logoOpacity * 100)}
                onChange={(e) => onLogoOpacityChange(Number(e.target.value) / 100)}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>
          </>
        )}
      </div>

      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <input
            id="header-show"
            type="checkbox"
            checked={header.show}
            onChange={(e) => onHeaderChange({ ...header, show: e.target.checked })}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="header-show" style={{ fontSize: 11, color: 'var(--text-label)', cursor: 'pointer' }}>
            Show header
          </label>
        </div>
        {header.show && (
          <input
            type="text"
            value={header.text}
            placeholder="Header text ({title}, {date})"
            onChange={(e) => onHeaderChange({ ...header, text: e.target.value })}
            style={{ width: '100%', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-input)', borderRadius: 4, padding: '4px 7px', fontSize: 11 }}
          />
        )}
      </div>

      {/* Footer */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <input
            id="footer-show"
            type="checkbox"
            checked={footer.show}
            onChange={(e) => onFooterChange({ ...footer, show: e.target.checked })}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="footer-show" style={{ fontSize: 11, color: 'var(--text-label)', cursor: 'pointer' }}>
            Show footer
          </label>
        </div>
        {footer.show && (
          <>
            <input
              type="text"
              value={footer.text}
              placeholder="Footer text ({title}, {date}, {slide_number})"
              onChange={(e) => onFooterChange({ ...footer, text: e.target.value })}
              style={{ width: '100%', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-input)', borderRadius: 4, padding: '4px 7px', fontSize: 11, marginBottom: 4 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                id="footer-slidenum"
                type="checkbox"
                checked={footer.show_slide_number}
                onChange={(e) => onFooterChange({ ...footer, show_slide_number: e.target.checked })}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="footer-slidenum" style={{ fontSize: 11, color: 'var(--text-label)', cursor: 'pointer' }}>
                Slide number
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
