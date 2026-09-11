import { useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import type { Theme } from '../../engine/theme';
import { useT } from '../../i18n';
import type { MessageKey } from '../../i18n';

interface Props {
  logo: string | undefined;
  logoPosition: Theme['logo_position'];
  logoOpacity: number;
  header: Theme['header'];
  footer: Theme['footer'];
  toc: Theme['toc'];
  logoOverridden?: boolean;
  headerOverridden?: boolean;
  footerOverridden?: boolean;
  tocOverridden?: boolean;
  onLogoChange: (path: string | undefined) => void;
  onLogoPositionChange: (pos: Theme['logo_position']) => void;
  onLogoOpacityChange: (opacity: number) => void;
  onHeaderChange: (header: Theme['header']) => void;
  onFooterChange: (footer: Theme['footer']) => void;
  onTocChange: (toc: Theme['toc']) => void;
}

const POSITIONS: Array<{ value: Theme['logo_position']; labelKey: MessageKey }> = [
  { value: 'top-left',     labelKey: 'inspector.positionTopLeft' },
  { value: 'top-right',    labelKey: 'inspector.positionTopRight' },
  { value: 'bottom-left',  labelKey: 'inspector.positionBottomLeft' },
  { value: 'bottom-right', labelKey: 'inspector.positionBottomRight' },
];

function OverrideDot({ show, hint }: { show: boolean; hint: string }) {
  if (!show) return null;
  return <span title={hint} style={{ color: 'var(--accent)', fontSize: 8, lineHeight: 1 }}>●</span>;
}

export function LogoControls({
  logo, logoPosition, logoOpacity, header, footer, toc,
  logoOverridden, headerOverridden, footerOverridden, tocOverridden,
  onLogoChange, onLogoPositionChange, onLogoOpacityChange, onHeaderChange, onFooterChange, onTocChange,
}: Props) {
  const t = useT();
  const overriddenHint = t('inspector.overriddenHint');
  const pickLogo = useCallback(async () => {
    const selected = await open({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'gif'] }],
      multiple: false,
    });
    if (selected && typeof selected === 'string') {
      onLogoChange(selected);
    }
  }, [onLogoChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Logo */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-label)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          {t('inspector.logoLabel')}
          <OverrideDot show={Boolean(logoOverridden)} hint={overriddenHint} />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {logo && (
            <img src={logo} alt="logo preview"
              style={{ height: 24, width: 'auto', borderRadius: 2, border: '1px solid var(--border-input)' }} />
          )}
          <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }} onClick={pickLogo}>
            {logo ? t('inspector.logoChange') : t('inspector.logoChoose')}
          </button>
          {logo && (
            <button className="btn" style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => onLogoChange(undefined)}>
              {t('common.remove')}
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
                    {t(p.labelKey)}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-label)' }}>{t('inspector.opacityLabel')}</span>
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
          <label htmlFor="header-show" style={{ fontSize: 11, color: 'var(--text-label)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            {t('inspector.showHeader')}
            <OverrideDot show={Boolean(headerOverridden)} hint={overriddenHint} />
          </label>
        </div>
        {header.show && (
          <>
            <input
              type="text"
              value={header.text}
              placeholder={t('inspector.headerPlaceholder')}
              onChange={(e) => onHeaderChange({ ...header, text: e.target.value })}
              style={{ width: '100%', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-input)', borderRadius: 4, padding: '4px 7px', fontSize: 11, marginBottom: 4 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                id="header-hide-on-title"
                type="checkbox"
                checked={Boolean(header.hide_on_title)}
                onChange={(e) => onHeaderChange({ ...header, hide_on_title: e.target.checked })}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="header-hide-on-title" style={{ fontSize: 11, color: 'var(--text-label)', cursor: 'pointer' }}>
                {t('inspector.hideHeaderOnTitle')}
              </label>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <input
            id="footer-show"
            type="checkbox"
            checked={footer.show}
            onChange={(e) => {
              const show = e.target.checked;
              onFooterChange({ ...footer, show, text: show && !footer.text.trim() ? '{title}' : footer.text });
            }}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="footer-show" style={{ fontSize: 11, color: 'var(--text-label)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            {t('inspector.showFooter')}
            <OverrideDot show={Boolean(footerOverridden)} hint={overriddenHint} />
          </label>
        </div>
        {footer.show && (
          <>
            <input
              type="text"
              value={footer.text}
              placeholder={t('inspector.footerPlaceholder')}
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
                {t('inspector.slideNumberLabel')}
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <input
                id="footer-hide-on-title"
                type="checkbox"
                checked={Boolean(footer.hide_on_title)}
                onChange={(e) => onFooterChange({ ...footer, hide_on_title: e.target.checked })}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="footer-hide-on-title" style={{ fontSize: 11, color: 'var(--text-label)', cursor: 'pointer' }}>
                {t('inspector.hideFooterOnTitle')}
              </label>
            </div>
          </>
        )}
      </div>

      {/* Table of contents */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-label)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          {t('inspector.tocSectionLabel')}
          <OverrideDot show={Boolean(tocOverridden)} hint={overriddenHint} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            id="toc-numbered"
            type="checkbox"
            checked={toc.numbered}
            onChange={(e) => onTocChange({ ...toc, numbered: e.target.checked })}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="toc-numbered" style={{ fontSize: 11, color: 'var(--text-label)', cursor: 'pointer' }}>
            {t('inspector.tocNumberedLabel')}
          </label>
        </div>
      </div>
    </div>
  );
}
