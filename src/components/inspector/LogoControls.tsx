import { useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Theme } from '../../engine/theme';

interface Props {
  logo: string | undefined;
  logoPosition: Theme['logo_position'];
  header: Theme['header'];
  footer: Theme['footer'];
  onLogoChange: (path: string | undefined) => void;
  onLogoPositionChange: (pos: Theme['logo_position']) => void;
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
  logo, logoPosition, header, footer,
  onLogoChange, onLogoPositionChange, onHeaderChange, onFooterChange,
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
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Logo</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {logo && (
            <img src={logo} alt="logo preview"
              style={{ height: 24, width: 'auto', borderRadius: 2, border: '1px solid #444' }} />
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
          <select
            value={logoPosition}
            onChange={(e) => onLogoPositionChange(e.target.value as Theme['logo_position'])}
            style={{ marginTop: 5, width: '100%', background: '#2a2a2a', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '3px 6px', fontSize: 11 }}
          >
            {POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
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
          <label htmlFor="header-show" style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>
            Show header
          </label>
        </div>
        {header.show && (
          <input
            type="text"
            value={header.text}
            placeholder="Header text ({title}, {date})"
            onChange={(e) => onHeaderChange({ ...header, text: e.target.value })}
            style={{ width: '100%', background: '#2a2a2a', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '4px 7px', fontSize: 11 }}
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
          <label htmlFor="footer-show" style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>
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
              style={{ width: '100%', background: '#2a2a2a', color: '#ccc', border: '1px solid #444', borderRadius: 4, padding: '4px 7px', fontSize: 11, marginBottom: 4 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                id="footer-slidenum"
                type="checkbox"
                checked={footer.show_slide_number}
                onChange={(e) => onFooterChange({ ...footer, show_slide_number: e.target.checked })}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="footer-slidenum" style={{ fontSize: 11, color: '#888', cursor: 'pointer' }}>
                Slide number
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
