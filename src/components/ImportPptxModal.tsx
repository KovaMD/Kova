import { useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { parsePptx } from '../engine/import/parsePptx';
import { pptxToMarkdown } from '../engine/import/pptxToMarkdown';
import { basename } from '../engine/paths';
import { useT } from '../i18n';
import { ModalShell } from './ModalShell';

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 'select' | 'processing' | 'done' | 'error';

interface DoneState {
  slideCount: number;
  warnings: string[];
  markdown: string;
  savedPath: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHECK = '✓';
const CROSS  = '✗';

const WILL_IMPORT_KEYS = [
  'modals.importPptxWill1',
  'modals.importPptxWill2',
  'modals.importPptxWill3',
  'modals.importPptxWill4',
  'modals.importPptxWill5',
] as const;

const WONT_IMPORT_KEYS = [
  'modals.importPptxWont1',
  'modals.importPptxWont2',
  'modals.importPptxWont3',
  'modals.importPptxWont4',
  'modals.importPptxWont5',
] as const;

// ── Modal ─────────────────────────────────────────────────────────────────────

interface ImportPptxModalProps {
  onImported: (markdown: string, savedPath: string) => void;
  onClose: () => void;
}

export function ImportPptxModal({ onImported, onClose }: ImportPptxModalProps) {
  const t = useT();
  const [step, setStep]             = useState<Step>('select');
  const [pptxPath, setPptxPath]     = useState<string>('');
  const [progress, setProgress]     = useState('');
  const [doneState, setDoneState]   = useState<DoneState | null>(null);
  const [errorMsg, setErrorMsg]     = useState('');
  const [warningsOpen, setWarningsOpen] = useState(false);

  // ── File picker ─────────────────────────────────────────────────────────────
  const handleBrowse = async () => {
    const selected = await open({
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      multiple: false,
    });
    if (selected && typeof selected === 'string') setPptxPath(selected);
  };

  // ── Main import flow ─────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!pptxPath) return;

    // Ask for save destination first
    const defaultName = basename(pptxPath).replace(/\.pptx$/i, '.md');
    const destPath = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: defaultName,
    });
    if (!destPath) return; // user cancelled

    const savePath = destPath.toLowerCase().endsWith('.md') ? destPath : `${destPath}.md`;
    const destDir  = savePath.replace(/[\\/][^\\/]+$/, ''); // parent directory

    setStep('processing');
    setProgress(t('modals.importPptxReadingFile'));

    try {
      setProgress(t('modals.importPptxParsingSlides'));
      const parseResult = await parsePptx(pptxPath, destDir);

      setProgress(t('modals.importPptxGeneratingMarkdown'));
      const markdown = pptxToMarkdown(parseResult);

      setProgress(t('modals.importPptxSavingFile'));
      await invoke('write_file', { path: savePath, content: markdown });

      setDoneState({
        slideCount: parseResult.slides.length,
        warnings: parseResult.warnings,
        markdown,
        savedPath: savePath,
      });
      setStep('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('encrypted')) {
        setErrorMsg(t('modals.importPptxPasswordProtected'));
      } else {
        setErrorMsg(msg);
      }
      setStep('error');
    }
  };

  const handleOpenInEditor = () => {
    if (doneState) onImported(doneState.markdown, doneState.savedPath);
  };

  // ── Shared overlay ────────────────────────────────────────────────────────────

  return (
    <ModalShell
      onClose={onClose}
      width={460}
      maxWidth="94vw"
      ariaLabel={t('modals.importPptxTitle')}
      cardStyle={{ maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
    >

        {/* ── Select step ── */}
        {step === 'select' && (
          <>
            <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                {t('modals.importPptxTitle')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('modals.importPptxDescription')}
              </div>
            </div>

            {/* File picker row */}
            <div style={{ padding: '16px 24px 0', flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('modals.importPptxFileLabel')}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{
                  flex: 1, padding: '6px 10px', fontSize: 12,
                  background: 'var(--bg-input)', border: '1px solid var(--border-alt)',
                  borderRadius: 4, color: pptxPath ? 'var(--text-primary)' : 'var(--text-secondary)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  cursor: 'pointer',
                }} onClick={handleBrowse} title={pptxPath || undefined}>
                  {pptxPath ? basename(pptxPath) : t('modals.importPptxNoFileSelected')}
                </div>
                <button className="btn" onClick={handleBrowse} style={{ flexShrink: 0 }}>
                  {t('modals.importPptxBrowse')}
                </button>
              </div>
            </div>

            {/* What will / won't be imported */}
            <div style={{ padding: '16px 24px 0', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t('modals.importPptxWillImport')}
                  </div>
                  {WILL_IMPORT_KEYS.map((key) => (
                    <div key={key} style={{ display: 'flex', gap: 6, marginBottom: 5, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                      <span style={{ color: '#4caf50', flexShrink: 0 }}>{CHECK}</span>
                      <span>{t(key)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t('modals.importPptxWontImport')}
                  </div>
                  {WONT_IMPORT_KEYS.map((key) => (
                    <div key={key} style={{ display: 'flex', gap: 6, marginBottom: 5, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      <span style={{ color: 'var(--text-tertiary, var(--text-secondary))', flexShrink: 0 }}>{CROSS}</span>
                      <span>{t(key)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
              <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                disabled={!pptxPath}
                onClick={handleImport}
              >
                {t('modals.importPptxContinue')}
              </button>
            </div>
          </>
        )}

        {/* ── Processing step ── */}
        {step === 'processing' && (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              {t('modals.importPptxImporting')}
            </div>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              border: '3px solid var(--border-alt)',
              borderTopColor: 'var(--accent)',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 16px',
            }} />
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{progress}</div>
          </div>
        )}

        {/* ── Done step ── */}
        {step === 'done' && doneState && (
          <>
            <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                {t('modals.importPptxComplete')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {t('modals.importPptxSlidesImported', { count: doneState.slideCount })}
              </div>
            </div>

            {doneState.warnings.length > 0 && (
              <div style={{ margin: '12px 24px 0', flexShrink: 0 }}>
                <button
                  style={{
                    width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', padding: '8px 12px', fontSize: 12,
                    background: 'var(--bg-input)', border: '1px solid var(--border-alt)',
                    borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer',
                  }}
                  onClick={() => setWarningsOpen(o => !o)}
                >
                  <span>{t('modals.importPptxItemsSkipped', { count: doneState.warnings.length })}</span>
                  <span>{warningsOpen ? '▲' : '▼'}</span>
                </button>
                {warningsOpen && (
                  <div style={{
                    maxHeight: 140, overflowY: 'auto',
                    padding: '8px 12px', fontSize: 11, lineHeight: 1.6,
                    background: 'var(--bg-input)', borderRadius: '0 0 4px 4px',
                    border: '1px solid var(--border-alt)', borderTop: 'none',
                    color: 'var(--text-secondary)',
                  }}>
                    {doneState.warnings.map((w, i) => <div key={i}>{w}</div>)}
                  </div>
                )}
              </div>
            )}

            <div style={{ padding: '8px 24px 4px', flex: 1, display: 'flex', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('modals.importPptxSavedToLabel')} <span style={{ color: 'var(--text-primary)', wordBreak: 'break-all' }}>{doneState.savedPath}</span>
              </div>
            </div>

            <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
              <button className="btn" onClick={onClose}>{t('common.close')}</button>
              <button className="btn btn-primary" onClick={handleOpenInEditor}>
                {t('modals.importPptxOpenInEditor')}
              </button>
            </div>
          </>
        )}

        {/* ── Error step ── */}
        {step === 'error' && (
          <>
            <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                {t('modals.importPptxFailed')}
              </div>
            </div>
            <div style={{ padding: '12px 24px', flex: 1 }}>
              <div style={{
                padding: '10px 14px', fontSize: 12, lineHeight: 1.6,
                background: 'var(--bg-input)', borderRadius: 4,
                border: '1px solid var(--border-alt)',
                color: '#e06c75',
              }}>
                {errorMsg}
              </div>
            </div>
            <div style={{ padding: '0 24px 20px', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
              <button className="btn" onClick={() => setStep('select')}>{t('common.back')}</button>
              <button className="btn" onClick={onClose}>{t('common.close')}</button>
            </div>
          </>
        )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </ModalShell>
  );
}
