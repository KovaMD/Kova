import { useMemo, useEffect } from 'react';
import type { AppSettings } from '../../../store/settings';
import { EDITOR_FONT_OPTIONS } from '../../../store/settings';
import type { Theme } from '../../../engine/theme';
import { isFontAvailable } from '../../../engine/fontDetect';
import { UI_LOCALE_OPTIONS, useT } from '../../../i18n';
import type { SectionProps } from '../types';
import { groupBtnStyle, Toggle, Row } from '../controls';

export function AppearanceSection({ settings, set, inView, allThemes }: SectionProps & { allThemes: Theme[] }) {
  const t = useT();

  const availableFonts = useMemo(() =>
    EDITOR_FONT_OPTIONS.filter(opt => opt.bundled || opt.value === 'system' || isFontAvailable(opt.family)),
    [],
  );

  // If the saved font is no longer available, reset to the bundled default
  useEffect(() => {
    if (!availableFonts.some(f => f.value === settings.editorFont)) {
      set('editorFont', 'ibm-plex-mono');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-off check on open: depending on settings/onChange would re-run on every settings edit
  }, []);
  return (
    <>
      {inView('appearance', `${t('settings.appTheme')} ${t('settings.themeAuto')} ${t('settings.themeDark')} ${t('settings.themeLight')}`) && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.appTheme')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { value: 'auto',  label: t('settings.themeAuto')  },
              { value: 'dark',  label: t('settings.themeDark')  },
              { value: 'light', label: t('settings.themeLight') },
            ] as const).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('uiTheme', value)}
                style={groupBtnStyle(settings.uiTheme === value)}
              >
                {label}
              </button>
            ))}
          </div>
          {settings.uiTheme === 'auto' && (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
              {t('settings.themeAutoDescription')}
            </div>
          )}
        </div>
      )}

      {inView('appearance', t('settings.displayLanguage')) && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.displayLanguage')}</div>
          <div style={{ position: 'relative' }}>
            <select
              value={settings.locale}
              onChange={(e) => set('locale', e.target.value)}
              style={{
                width: '100%',
                padding: '6px 28px 6px 10px',
                fontSize: 12,
                borderRadius: 4,
                border: '1px solid var(--border-alt)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
                outline: 'none',
              }}
            >
              {UI_LOCALE_OPTIONS.map(({ code, label }) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
            <svg viewBox="0 0 10 6" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)' }}>
              <path d="M0 0l5 6 5-6z" fill="currentColor" />
            </svg>
          </div>
        </div>
      )}

      {inView('appearance', t('settings.interfaceScale')) && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.interfaceScale')}</div>
          <div style={{ position: 'relative' }}>
            <select
              value={Math.round(settings.uiScale * 100)}
              onChange={(e) => set('uiScale', Number(e.target.value) / 100)}
              style={{
                width: '100%',
                padding: '6px 28px 6px 10px',
                fontSize: 12,
                borderRadius: 4,
                border: '1px solid var(--border-alt)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
                outline: 'none',
              }}
            >
              {[70, 80, 90, 100, 110, 120, 130, 140, 150].map(pct => (
                <option key={pct} value={pct}>{pct}%</option>
              ))}
            </select>
            <svg viewBox="0 0 10 6" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)' }}>
              <path d="M0 0l5 6 5-6z" fill="currentColor" />
            </svg>
          </div>
        </div>
      )}

      {inView('appearance', t('settings.editorFont')) && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.editorFont')}</div>
          <div style={{ position: 'relative' }}>
            <select
              value={settings.editorFont}
              onChange={(e) => set('editorFont', e.target.value as AppSettings['editorFont'])}
              style={{
                width: '100%',
                padding: '6px 28px 6px 10px',
                fontSize: 12,
                fontFamily: availableFonts.find(o => o.value === settings.editorFont)?.family ?? 'monospace',
                borderRadius: 4,
                border: '1px solid var(--border-alt)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
                outline: 'none',
              }}
            >
              {availableFonts.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <svg
              viewBox="0 0 10 6"
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)',
              }}
            >
              <path d="M0 0l5 6 5-6z" fill="currentColor" />
            </svg>
          </div>
        </div>
      )}

      {inView('appearance', `${t('settings.showFrontmatter')} ${t('settings.showFrontmatterDescription')}`) && (
        <Row
          label={t('settings.showFrontmatter')}
          description={t('settings.showFrontmatterDescription')}
          control={<Toggle checked={settings.showFrontmatter} onChange={(v) => set('showFrontmatter', v)} />}
        />
      )}

      {inView('appearance', `${t('settings.wordWrap')} ${t('settings.wordWrapDescription')}`) && (
        <Row
          label={t('settings.wordWrap')}
          description={t('settings.wordWrapDescription')}
          control={<Toggle checked={settings.editorWordWrap} onChange={(v) => set('editorWordWrap', v)} />}
        />
      )}

      {inView('appearance', `${t('settings.contentWidth')} ${t('settings.contentWidthDescription')}`) && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{t('settings.contentWidth')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            {t('settings.contentWidthDescription')}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { value: 'fixed', label: t('settings.contentWidthFixed') },
              { value: 'full',  label: t('settings.contentWidthFull')  },
            ] as { value: AppSettings['editorContentWidth']; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('editorContentWidth', value)}
                style={groupBtnStyle(settings.editorContentWidth === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {inView('appearance', `${t('settings.defaultTheme')} ${t('settings.defaultThemeDescription')}`) && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.defaultTheme')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
            {t('settings.defaultThemeDescription')}
          </div>
          <div style={{ position: 'relative' }}>
            <select
              value={settings.defaultThemeId}
              onChange={(e) => set('defaultThemeId', e.target.value)}
              style={{
                width: '100%',
                padding: '6px 28px 6px 10px',
                fontSize: 12,
                borderRadius: 4,
                border: '1px solid var(--border-alt)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
                outline: 'none',
              }}
            >
              {allThemes.map(({ id, name }) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <svg
              viewBox="0 0 10 6"
              style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)',
              }}
            >
              <path d="M0 0l5 6 5-6z" fill="currentColor" />
            </svg>
          </div>
        </div>
      )}
    </>
  );
}
