import { useT } from '../../i18n';
import { InfoBanner } from '../InfoBanner';
import { MissingThemeBanner } from '../MissingThemeBanner';
import { ModalShell } from '../ModalShell';
import { recentFileBasename } from '../../store/recentFiles';
import { APP_VERSION } from '../../version';

export interface AppDialogsProps {
  // Marp detection prompt + post-import loss notice
  marpPromptOpen: boolean;
  onMarpConvert: () => void;
  onMarpDismiss: () => void;
  marpLoss: number | null;
  onMarpLossDismiss: () => void;

  // Missing theme banner
  missingThemeId: string | null;
  onMissingThemeInstalled: (themeId: string) => void;
  onMissingThemeDismiss: () => void;

  // "What's new" banner
  showWhatsNew: boolean;
  onWhatsNewOpen: () => void;
  onWhatsNewDismiss: () => void;

  // Transient warning toast
  warnMessage: string | null;

  // External file change (dirty: blocking modal; clean: banner)
  externalChangeOpen: boolean;
  onExternalChangeClose: () => void;
  onExternalChangeReload: () => void;
  onExternalChangeSaveAs: () => void;
  externalReloadBannerOpen: boolean;
  onExternalReloadBannerDismiss: () => void;

  // PDF export options
  pdfOptionsOpen: boolean;
  pdfPerPage: number;
  pdfNotesOn: boolean;
  /** Whether any visible slide has speaker notes. */
  pdfHasNotes: boolean;
  onPdfPerPageChange: (n: number) => void;
  onPdfNotesChange: (on: boolean) => void;
  onPdfOptionsClose: () => void;
  onPdfExport: () => void;

  // Unsaved-changes confirm before close/replace
  confirmCloseOpen: boolean;
  onConfirmCloseCancel: () => void;
  onConfirmCloseDiscard: () => void;
  onConfirmCloseSave: () => void;

  // Drag-and-drop open confirm
  dropConfirmPath: string | null;
  onDropConfirmCancel: () => void;
  onDropConfirmOpen: () => void;
}

/**
 * App-level banners and modal dialogs. Pure presentation: App owns every
 * piece of state and every handler, this only renders whichever are open.
 */
export function AppDialogs({
  marpPromptOpen, onMarpConvert, onMarpDismiss, marpLoss, onMarpLossDismiss,
  missingThemeId, onMissingThemeInstalled, onMissingThemeDismiss,
  showWhatsNew, onWhatsNewOpen, onWhatsNewDismiss,
  warnMessage,
  externalChangeOpen, onExternalChangeClose, onExternalChangeReload, onExternalChangeSaveAs,
  externalReloadBannerOpen, onExternalReloadBannerDismiss,
  pdfOptionsOpen, pdfPerPage, pdfNotesOn, pdfHasNotes,
  onPdfPerPageChange, onPdfNotesChange, onPdfOptionsClose, onPdfExport,
  confirmCloseOpen, onConfirmCloseCancel, onConfirmCloseDiscard, onConfirmCloseSave,
  dropConfirmPath, onDropConfirmCancel, onDropConfirmOpen,
}: AppDialogsProps) {
  const t = useT();
  return (
    <>
      {marpPromptOpen && (
        <InfoBanner
          message={t('app.marpDetected')}
          actions={[{
            label: t('app.marpConvert'),
            onClick: onMarpConvert,
          }]}
          onDismiss={onMarpDismiss}
        />
      )}
      {marpLoss != null && marpLoss > 0 && (
        <InfoBanner
          message={t('app.marpImported', { count: marpLoss })}
          onDismiss={onMarpLossDismiss}
        />
      )}

      {missingThemeId && (
        <MissingThemeBanner
          themeId={missingThemeId}
          onInstalled={onMissingThemeInstalled}
          onDismiss={onMissingThemeDismiss}
        />
      )}

      {showWhatsNew && (
        <InfoBanner
          message={t('app.whatsNewMessage', { version: APP_VERSION })}
          actions={[{
            label: t('app.whatsNewAction'),
            onClick: onWhatsNewOpen,
          }]}
          onDismiss={onWhatsNewDismiss}
        />
      )}

      {warnMessage && (
        <div style={{
          position: 'fixed', bottom: 36, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-elevated)', border: '1px solid var(--dirty-color)',
          borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 3000,
          padding: '10px 16px', fontSize: 12, color: 'var(--dirty-color)',
          maxWidth: 480, textAlign: 'center', pointerEvents: 'none', whiteSpace: 'pre-wrap',
        }}>
          {warnMessage}
        </div>
      )}

      {externalChangeOpen && (
        <ModalShell
          onClose={onExternalChangeClose}
          dismissOnBackdropClick={false}
          dismissOnEscape={false}
          width={340}
          maxWidth="90vw"
          ariaLabel={t('app.fileChangedExternally')}
          cardStyle={{ padding: '24px 28px' }}
        >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              {t('app.fileChangedExternally')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              {t('app.fileChangedExternallyDirty')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="btn btn-primary"
                onClick={onExternalChangeReload}
              >{t('common.reload')}</button>
              <button
                className="btn"
                onClick={onExternalChangeSaveAs}
              >{t('common.saveAs')}</button>
            </div>
        </ModalShell>
      )}

      {externalReloadBannerOpen && (
        <InfoBanner
          message={t('app.fileChangedExternallyClean')}
          onDismiss={onExternalReloadBannerDismiss}
        />
      )}

      {pdfOptionsOpen && (
        <ModalShell
          onClose={onPdfOptionsClose}
          width={360}
          maxWidth="90vw"
          ariaLabel={t('app.exportPdfTitle')}
          cardStyle={{ padding: '24px 28px' }}
        >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
              {t('app.exportPdfTitle')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-label)', marginBottom: 8 }}>{t('app.slidesPerPage')}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              {[1, 2, 4, 6].map((n) => (
                <button
                  key={n}
                  className={pdfPerPage === n ? 'btn btn-primary' : 'btn'}
                  style={{ flex: 1 }}
                  onClick={() => onPdfPerPageChange(n)}
                >{n}</button>
              ))}
            </div>
            {(() => {
              const notesOk = pdfPerPage === 1 && pdfHasNotes;
              return (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: notesOk ? 'var(--text-primary)' : 'var(--text-secondary)', opacity: notesOk ? 1 : 0.5, marginBottom: 20 }}>
                  <input
                    type="checkbox"
                    checked={notesOk && pdfNotesOn}
                    disabled={!notesOk}
                    onChange={(e) => onPdfNotesChange(e.target.checked)}
                  />
                  {t('app.includeSpeakerNotes', { noneNote: pdfPerPage === 1 && !pdfHasNotes ? t('app.includeSpeakerNotesNone') : '' })}
                </label>
              );
            })()}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={onPdfOptionsClose}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={onPdfExport}
              >{t('app.exportAction')}</button>
            </div>
        </ModalShell>
      )}

      {confirmCloseOpen && (
        <ModalShell
          onClose={onConfirmCloseCancel}
          width={320}
          maxWidth="90vw"
          ariaLabel={t('app.unsavedChangesTitle')}
          cardStyle={{ padding: '24px 28px' }}
        >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              {t('app.unsavedChangesTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              {t('app.unsavedChangesMessage')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={onConfirmCloseCancel}>{t('common.cancel')}</button>
              <button
                className="btn"
                style={{ background: '#c0392b', borderColor: '#c0392b', color: '#fff' }}
                onClick={onConfirmCloseDiscard}
              >{t('common.discard')}</button>
              <button
                className="btn btn-primary"
                onClick={onConfirmCloseSave}
              >{t('common.save')}</button>
            </div>
        </ModalShell>
      )}

      {dropConfirmPath && (
        <ModalShell
          onClose={onDropConfirmCancel}
          width={340}
          maxWidth="90vw"
          ariaLabel={t('app.openFileTitle')}
          cardStyle={{ padding: '24px 28px' }}
        >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              {t('app.openFileTitle')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
              {t('app.openFileReplaceWarningPrefix')} <strong>{recentFileBasename(dropConfirmPath)}</strong> {t('app.openFileReplaceWarningSuffix')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={onDropConfirmCancel}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={onDropConfirmOpen}
              >{t('common.open')}</button>
            </div>
        </ModalShell>
      )}
    </>
  );
}
