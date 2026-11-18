import type { AppSettings, StartupBehavior } from '../../../store/settings';
import { useT } from '../../../i18n';
import type { SectionProps } from '../types';
import { groupBtnStyle, Toggle, Row } from '../controls';

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
        <div style={{ paddingBottom: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--text-label)', marginBottom: 8 }}>{t('settings.saveEvery')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {INTERVAL_OPTIONS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => set('autosaveIntervalSeconds', value)}
                style={groupBtnStyle(settings.autosaveIntervalSeconds === value)}
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
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{t('settings.onStartup')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            {t('settings.onStartupDescription')}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { value: 'blank',      label: t('settings.startupBlank') },
              { value: 'reopenLast', label: t('settings.startupReopenLast') },
            ] as { value: StartupBehavior; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('startupBehavior', value)}
                style={groupBtnStyle(settings.startupBehavior === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {inView('workspace', `${t('settings.pdfPageSize')} ${t('settings.pdfPageSizeDescription')}`) && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{t('settings.pdfPageSize')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            {t('settings.pdfPageSizeDescription')}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { value: 'a4',     label: t('settings.pageSizeA4')     },
              { value: 'letter', label: t('settings.pageSizeLetter') },
              { value: 'slide',  label: t('settings.pageSizeSlide')  },
            ] as { value: AppSettings['pdfPageSize']; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('pdfPageSize', value)}
                style={groupBtnStyle(settings.pdfPageSize === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {inView('workspace', `${t('settings.diagramRenderer')} ${t('settings.diagramRendererDescription')}`) && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{t('settings.diagramRenderer')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            {t('settings.diagramRendererDescription')}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { value: 'pele',    label: t('settings.diagramRendererPele')    },
              { value: 'mermaid', label: t('settings.diagramRendererMermaid') },
            ] as { value: AppSettings['diagramRenderer']; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('diagramRenderer', value)}
                style={groupBtnStyle(settings.diagramRenderer === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
