import { useT } from '../../i18n';
import type { FindReplaceState } from '../../hooks/useFindReplace';

export interface FindReplaceDialogProps {
  findReplace: FindReplaceState;
}

const inputStyle = {
  flex: 1,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-panel)',
  color: 'var(--text-primary)',
  outline: 'none',
} as const;

/** Floating Find / Replace / go-to-slide dialog; renders nothing while closed. */
export function FindReplaceDialog({ findReplace }: FindReplaceDialogProps) {
  const t = useT();
  if (!findReplace.open) return null;
  const {
    mode, query, showReplace, replaceQuery, replacedCount, inputRef, slideCount,
    close, setMode, setQuery, setShowReplace, setReplaceQuery, runFind, runReplace, runReplaceAll,
  } = findReplace;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
      onMouseDown={(e) => { e.preventDefault(); close(); }}
    >
      <div
        role="dialog"
        aria-label={t('editor.findDialogTitle')}
        onMouseDown={(e) => e.stopPropagation()}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
        style={{
          position: 'fixed',
          left: '50%',
          top: 18,
          transform: 'translateX(-50%)',
          width: 420,
          maxWidth: 'calc(100vw - 32px)',
          padding: 10,
          borderRadius: 10,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-alt)',
          boxShadow: '0 10px 40px rgba(0,0,0,0.55)',
          color: 'var(--text-primary)',
          fontSize: 13,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{t('editor.findDialogTitle')}</div>
          <button
            className="btn"
            onClick={close}
            aria-label={t('common.close')}
          >{t('common.close')}</button>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="find-mode"
              checked={mode === 'text'}
              onChange={() => setMode('text')}
            />
            {t('editor.findModeText')}
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="find-mode"
              checked={mode === 'slide'}
              onChange={() => setMode('slide')}
            />
            {t('editor.findModeSlide')}
          </label>
          {mode === 'text' && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginLeft: 'auto' }}>
              <input
                type="checkbox"
                checked={showReplace}
                onChange={(e) => setShowReplace(e.target.checked)}
              />
              {t('editor.findReplaceToggle')}
            </label>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={inputRef}
            value={query}
            placeholder={mode === 'slide'
              ? t('editor.findPlaceholderSlide', { total: slideCount })
              : t('editor.findPlaceholderText')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); close(); }
              if (e.key === 'Enter') { e.preventDefault(); runFind(e.shiftKey ? -1 : 1); }
            }}
            style={inputStyle}
          />
          {mode === 'text' ? (
            <>
              <button
                className="btn"
                onClick={() => runFind(-1)}
              >
                {t('editor.findPrevious')}
              </button>
              <button
                className="btn btn--primary"
                onClick={() => runFind(1)}
              >
                {t('editor.findNext')}
              </button>
            </>
          ) : (
            <button
              className="btn btn--primary"
              onClick={() => runFind(1)}
            >
              {t('common.ok')}
            </button>
          )}
        </div>

        {mode === 'text' && showReplace && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <input
              value={replaceQuery}
              placeholder={t('editor.findReplacePlaceholder')}
              onChange={(e) => setReplaceQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); close(); }
                if (e.key === 'Enter') { e.preventDefault(); runReplace(); }
              }}
              style={inputStyle}
            />
            <button className="btn" onClick={runReplace} disabled={!query.trim()}>
              {t('editor.findReplaceButton')}
            </button>
            <button className="btn" onClick={runReplaceAll} disabled={!query.trim()}>
              {t('editor.findReplaceAllButton')}
            </button>
          </div>
        )}
        {replacedCount !== null && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('editor.findReplacedCount', { count: replacedCount })}
          </div>
        )}
      </div>
    </div>
  );
}
