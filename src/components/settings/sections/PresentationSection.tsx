import type { PresentationMode, NotesFontSize, LaserColor } from '../../../store/settings';
import { LASER_COLOR_OPTIONS } from '../../../store/settings';
import { useT } from '../../../i18n';
import type { SectionProps } from '../types';
import { groupBtnClass, Toggle, Row } from '../controls';

export function PresentationSection({ settings, set, inView }: SectionProps) {
  const t = useT();

  return (
    <>
      {inView('presentation', `${t('settings.displayMode')} ${t('settings.displayModeDescription')}`) && (
        <div className="settings-field">
          <div className="settings-field__label settings-field__label--tight">{t('settings.displayMode')}</div>
          <div className="settings-field__desc">
            {t('settings.displayModeDescription')}
          </div>
          <div className="settings-group">
            {([
              { value: 'auto',   label: t('settings.displayModeAuto')   },
              { value: 'single', label: t('settings.displayModeSingle') },
              { value: 'dual',   label: t('settings.displayModeDual')   },
              { value: 'mirror', label: t('settings.displayModeMirror') },
            ] as { value: PresentationMode; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('presentationMode', value)}
                className={groupBtnClass(settings.presentationMode === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Directly under Display mode: adjusted more often than the other
          presenter-view options. */}
      {inView('presentation', t('settings.notesFontSize')) && (settings.presentationMode === 'dual' || settings.presentationMode === 'auto') && (
        <div className="settings-field">
          <div className="settings-field__label">{t('settings.notesFontSize')}</div>
          <div className="settings-group">
            {([
              { value: 'sm', label: t('settings.fontSizeSmall')  },
              { value: 'md', label: t('settings.fontSizeMedium') },
              { value: 'lg', label: t('settings.fontSizeLarge')  },
            ] as { value: NotesFontSize; label: string }[]).map(({ value, label }) => (
              <button key={value} type="button" onClick={() => set('presenterNotesFontSize', value)}
                className={groupBtnClass(settings.presenterNotesFontSize === value)}
              >{label}</button>
            ))}
          </div>
        </div>
      )}

      {inView('presentation', t('settings.laserPointerColour')) && (
        <Row
          label={t('settings.laserPointerColour')}
          control={
            <div className="settings-swatches">
              {LASER_COLOR_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  title={label}
                  onClick={() => set('laserColor', value as LaserColor)}
                  className={`settings-swatch${settings.laserColor === value ? ' settings-swatch--active' : ''}`}
                  style={{ background: value }}
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
            <div className="settings-field--countdown">
              <div className="settings-field__label settings-field__label--tight">{t('settings.countdownTarget')}</div>
              <div className="settings-field__desc settings-field__desc--snug">
                {t('settings.countdownTargetDescription')}
              </div>
              <div className="settings-group settings-group--wrap">
                {[0, 5, 10, 15, 20, 30, 45, 60].map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => set('presenterCountdownMinutes', mins)}
                    className={groupBtnClass(settings.presenterCountdownMinutes === mins, 'settings-group-btn--compact')}
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
