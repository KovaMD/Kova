import { useMemo, useEffect } from 'react';
import type { AppSettings } from '../../../store/settings';
import { EDITOR_FONT_OPTIONS } from '../../../store/settings';
import type { Theme } from '../../../engine/theme';
import { isFontAvailable } from '../../../engine/fontDetect';
import { UI_LOCALE_OPTIONS, useT } from '../../../i18n';
import type { SectionProps } from '../types';
import { groupBtnClass, Toggle, Row, Select } from '../controls';

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
        <div className="settings-field">
          <div className="settings-field__label">{t('settings.appTheme')}</div>
          <div className="settings-group">
            {([
              { value: 'auto',  label: t('settings.themeAuto')  },
              { value: 'dark',  label: t('settings.themeDark')  },
              { value: 'light', label: t('settings.themeLight') },
            ] as const).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('uiTheme', value)}
                className={groupBtnClass(settings.uiTheme === value)}
              >
                {label}
              </button>
            ))}
          </div>
          {settings.uiTheme === 'auto' && (
            <div className="settings-field__hint">
              {t('settings.themeAutoDescription')}
            </div>
          )}
        </div>
      )}

      {inView('appearance', t('settings.displayLanguage')) && (
        <div className="settings-field">
          <div className="settings-field__label">{t('settings.displayLanguage')}</div>
          <Select value={settings.locale} onChange={(e) => set('locale', e.target.value)}>
            {UI_LOCALE_OPTIONS.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </Select>
        </div>
      )}

      {inView('appearance', t('settings.interfaceScale')) && (
        <div className="settings-field">
          <div className="settings-field__label">{t('settings.interfaceScale')}</div>
          <Select
            value={Math.round(settings.uiScale * 100)}
            onChange={(e) => set('uiScale', Number(e.target.value) / 100)}
          >
            {[70, 80, 90, 100, 110, 120, 130, 140, 150].map(pct => (
              <option key={pct} value={pct}>{pct}%</option>
            ))}
          </Select>
        </div>
      )}

      {inView('appearance', t('settings.editorFont')) && (
        <div className="settings-field">
          <div className="settings-field__label">{t('settings.editorFont')}</div>
          <Select
            value={settings.editorFont}
            onChange={(e) => set('editorFont', e.target.value as AppSettings['editorFont'])}
            style={{ fontFamily: availableFonts.find(o => o.value === settings.editorFont)?.family ?? 'monospace' }}
          >
            {availableFonts.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
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
        <div className="settings-field">
          <div className="settings-field__label settings-field__label--tight">{t('settings.contentWidth')}</div>
          <div className="settings-field__desc">
            {t('settings.contentWidthDescription')}
          </div>
          <div className="settings-group">
            {([
              { value: 'fixed', label: t('settings.contentWidthFixed') },
              { value: 'full',  label: t('settings.contentWidthFull')  },
            ] as { value: AppSettings['editorContentWidth']; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('editorContentWidth', value)}
                className={groupBtnClass(settings.editorContentWidth === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {inView('appearance', `${t('settings.defaultTheme')} ${t('settings.defaultThemeDescription')}`) && (
        <div className="settings-field">
          <div className="settings-field__label">{t('settings.defaultTheme')}</div>
          <div className="settings-field__note">
            {t('settings.defaultThemeDescription')}
          </div>
          <Select value={settings.defaultThemeId} onChange={(e) => set('defaultThemeId', e.target.value)}>
            {allThemes.map(({ id, name }) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </Select>
        </div>
      )}
    </>
  );
}
