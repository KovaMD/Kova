import type { PresentationMode, NotesFontSize, LaserColor } from '../../../store/settings';
import { LASER_COLOR_OPTIONS } from '../../../store/settings';
import { useT } from '../../../i18n';
import type { SectionProps } from '../types';
import { groupBtnStyle, Toggle, Row } from '../controls';

export function PresentationSection({ settings, set, inView }: SectionProps) {
  const t = useT();
  return (
    <>
      {inView('presentation', `${t('settings.displayMode')} ${t('settings.displayModeDescription')}`) && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{t('settings.displayMode')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
            {t('settings.displayModeDescription')}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { value: 'auto',   label: t('settings.displayModeAuto')   },
              { value: 'single', label: t('settings.displayModeSingle') },
              { value: 'dual',   label: t('settings.displayModeDual')   },
              { value: 'mirror', label: t('settings.displayModeMirror') },
            ] as { value: PresentationMode; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('presentationMode', value)}
                style={groupBtnStyle(settings.presentationMode === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Directly under Display mode: adjusted more often than the other
          presenter-view options. */}
      {inView('presentation', t('settings.notesFontSize')) && (settings.presentationMode === 'dual' || settings.presentationMode === 'auto') && (
        <div style={{ padding: '10px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.notesFontSize')}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { value: 'sm', label: t('settings.fontSizeSmall')  },
              { value: 'md', label: t('settings.fontSizeMedium') },
              { value: 'lg', label: t('settings.fontSizeLarge')  },
            ] as { value: NotesFontSize; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('presenterNotesFontSize', value)}
                style={groupBtnStyle(settings.presenterNotesFontSize === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {inView('presentation', t('settings.laserPointerColour')) && (
        <Row
          label={t('settings.laserPointerColour')}
          control={
            <div style={{ display: 'flex', gap: 8 }}>
              {LASER_COLOR_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  title={label}
                  onClick={() => set('laserColor', value as LaserColor)}
                  style={{
                    width: 22, height: 22, borderRadius: '50%', padding: 0,
                    background: value,
                    border: settings.laserColor === value
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                    outline: settings.laserColor === value ? '1px solid var(--accent)' : '1px solid var(--border)',
                    outlineOffset: 2,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
              ))}
            </div>
          }
        />
      )}

      {inView('presentation', `${t('settings.windowedPresenterView')} ${t('settings.windowedPresenterViewDescription')} ${t('settings.alwaysOnTop')} ${t('settings.alwaysOnTopDescription')} ${t('settings.showNextSlidePreview')} ${t('settings.showElapsedTimer')} ${t('settings.countdownTarget')} ${t('settings.countdownTargetDescription')}`) && (settings.presentationMode === 'dual' || settings.presentationMode === 'auto') && (
        <>
          <Row
            label={t('settings.windowedPresenterView')}
            description={t('settings.windowedPresenterViewDescription')}
            control={<Toggle checked={settings.presenterWindowed} onChange={(v) => set('presenterWindowed', v)} />}
          />
          {settings.presenterWindowed && (
            <Row
              label={t('settings.alwaysOnTop')}
              description={t('settings.alwaysOnTopDescription')}
              control={<Toggle checked={settings.presenterAlwaysOnTop} onChange={(v) => set('presenterAlwaysOnTop', v)} />}
            />
          )}
          <Row
            label={t('settings.showNextSlidePreview')}
            description={t('settings.showNextSlidePreviewDescription')}
            control={<Toggle checked={settings.presenterShowNextSlide} onChange={(v) => set('presenterShowNextSlide', v)} />}
          />
          <Row
            label={t('settings.showElapsedTimer')}
            description={t('settings.showElapsedTimerDescription')}
            control={<Toggle checked={settings.presenterShowTimer} onChange={(v) => set('presenterShowTimer', v)} />}
          />
          {settings.presenterShowTimer && (
            <div style={{ padding: '6px 0 10px' }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{t('settings.countdownTarget')}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
                {t('settings.countdownTargetDescription')}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[0, 5, 10, 15, 20, 30, 45, 60].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => set('presenterCountdownMinutes', mins)}
                    style={{ ...groupBtnStyle(settings.presenterCountdownMinutes === mins), flex: '0 1 auto', padding: '5px 10px' }}
                  >{mins === 0 ? t('settings.countdownOff') : t('settings.countdownMinutes', { count: mins })}</button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Not gated on display mode like its neighbours: the bar shows in
          every mode, not just the presenter view. */}
      {inView('presentation', `${t('settings.showProgressBar')} ${t('settings.showProgressBarDescription')}`) && (
        <Row
          label={t('settings.showProgressBar')}
          description={t('settings.showProgressBarDescription')}
          control={<Toggle checked={settings.presentationShowProgressBar} onChange={(v) => set('presentationShowProgressBar', v)} />}
        />
      )}
    </>
  );
}
