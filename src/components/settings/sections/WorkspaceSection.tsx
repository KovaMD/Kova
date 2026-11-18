import type { AppSettings, StartupBehavior } from '../../../store/settings';
import { useT } from '../../../i18n';
import type { SectionProps } from '../types';
import { groupBtnClass, Toggle, Row } from '../controls';

const INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: '15 sec',  value: 15  },
  { label: '30 sec',  value: 30  },
  { label: '1 min',   value: 60  },
  { label: '5 min',   value: 300 },
];

export function WorkspaceSection({ settings, set, inView }: SectionProps) {
  const t = useT();

  return (
    <>
      {inView('workspace', `${t('settings.autosave')} ${t('settings.autosaveDescription')}`) && (
        <Row
          label={t('settings.autosave')}
          description={t('settings.autosaveDescription')}
          control={<Toggle checked={settings.autosave} onChange={(v) => set('autosave', v)} />}
        />
      )}

      {inView('workspace', t('settings.saveEvery')) && settings.autosave && (
        <div className="settings-subfield settings-subfield--short">
          <div className="settings-field__sublabel">{t('settings.saveEvery')}</div>
          <div className="settings-group">
            {INTERVAL_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => set('autosaveIntervalSeconds', value)}
                className={groupBtnClass(settings.autosaveIntervalSeconds === value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {inView('workspace', `${t('settings.confirmBeforeClosing')} ${t('settings.confirmBeforeClosingDescription')}`) && (
        <Row
          label={t('settings.confirmBeforeClosing')}
          description={t('settings.confirmBeforeClosingDescription')}
          control={<Toggle checked={settings.confirmOnClose} onChange={(v) => set('confirmOnClose', v)} />}
        />
      )}

      {inView('workspace', `${t('settings.onStartup')} ${t('settings.onStartupDescription')}`) && (
        <div className="settings-field">
          <div className="settings-field__label settings-field__label--tight">{t('settings.onStartup')}</div>
          <div className="settings-field__desc">
            {t('settings.onStartupDescription')}
          </div>
          <div className="settings-group">
            {([
              { value: 'blank',      label: t('settings.startupBlank') },
              { value: 'reopenLast', label: t('settings.startupReopenLast') },
            ] as { value: StartupBehavior; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('startupBehavior', value)}
                className={groupBtnClass(settings.startupBehavior === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {inView('workspace', `${t('settings.pdfPageSize')} ${t('settings.pdfPageSizeDescription')}`) && (
        <div className="settings-field">
          <div className="settings-field__label settings-field__label--tight">{t('settings.pdfPageSize')}</div>
          <div className="settings-field__desc">
            {t('settings.pdfPageSizeDescription')}
          </div>
          <div className="settings-group">
            {([
              { value: 'a4',     label: t('settings.pageSizeA4')     },
              { value: 'letter', label: t('settings.pageSizeLetter') },
              { value: 'slide',  label: t('settings.pageSizeSlide')  },
            ] as { value: AppSettings['pdfPageSize']; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('pdfPageSize', value)}
                className={groupBtnClass(settings.pdfPageSize === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {inView('workspace', `${t('settings.diagramRenderer')} ${t('settings.diagramRendererDescription')}`) && (
        <div className="settings-field">
          <div className="settings-field__label settings-field__label--tight">{t('settings.diagramRenderer')}</div>
          <div className="settings-field__desc">
            {t('settings.diagramRendererDescription')}
          </div>
          <div className="settings-group">
            {([
              { value: 'pele',    label: t('settings.diagramRendererPele')    },
              { value: 'mermaid', label: t('settings.diagramRendererMermaid') },
            ] as { value: AppSettings['diagramRenderer']; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('diagramRenderer', value)}
                className={groupBtnClass(settings.diagramRenderer === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
