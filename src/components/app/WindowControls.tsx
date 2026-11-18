import { getCurrentWindow } from '@tauri-apps/api/window';
import { useT } from '../../i18n';

export interface WindowControlsProps {
  /** Close button handler (App guards unsaved changes before closing). */
  onClose: () => void;
}

/** Custom minimise / maximise / close buttons for the frameless window
 *  (Windows/Linux; macOS uses native traffic lights). */
export function WindowControls({ onClose }: WindowControlsProps) {
  const t = useT();
  return (
    <div className="wm-controls">
      <button
        className="wm-btn"
        onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().minimize(); }}
        title={t('app.minimise')}
      >
        <svg width="12" height="2" viewBox="0 0 12 2"><rect width="12" height="2" rx="1" fill="currentColor"/></svg>
      </button>
      <button
        className="wm-btn"
        onMouseDown={(e) => { e.preventDefault(); getCurrentWindow().toggleMaximize(); }}
        title={t('app.maximiseRestore')}
      >
        <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1" y="1" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
      </button>
      <button
        className="wm-btn wm-btn--close"
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
        title={t('app.windowClose')}
      >
        <svg width="11" height="11" viewBox="0 0 11 11">
          <line x1="1" y1="1" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="10" y1="1" x2="1" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
