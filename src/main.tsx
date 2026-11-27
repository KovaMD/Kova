import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/400-italic.css';
import '@fontsource/ibm-plex-mono/700.css';
import App from "./App";
import { AudienceApp } from "./AudienceApp";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { installTauriEnginePorts } from "./platform/enginePorts";
import { bestEffort } from './platform/bestEffort';

// Composition root: bind the platform-free engine to its Tauri adapters
// before anything renders (see src/engine/ports.ts).
installTauriEnginePorts();

// Last-resort fallback if a render crash escapes every inner boundary. Without
// this, a crash inside a borderless/fullscreen presentation window (no
// decorations, Escape handler torn down with the rest of the tree) leaves the
// user with no way to close it short of a Task Manager kill — see #134.
function CrashFallback() {
  React.useEffect(() => {
    void bestEffort(getCurrentWindow().setFullscreen(false), 'setFullscreen');
    void bestEffort(WebviewWindow.getByLabel('audience').then((win) => win?.close()), 'close audience window');
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      background: '#1e1e1e', color: '#eee', fontFamily: 'sans-serif', textAlign: 'center', padding: 24,
    }}>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Kova hit an unexpected error</div>
      <div style={{ fontSize: 14, opacity: 0.8, maxWidth: 480 }}>
        The window has been restored so it isn't stuck fullscreen. Reloading will return you to the editor.
      </div>
      <button onClick={() => window.location.reload()} style={{ padding: '8px 20px', fontSize: 14, cursor: 'pointer' }}>
        Reload
      </button>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
const view = window.location.hash === '#audience' ? <AudienceApp /> : <App />;

root.render(
  <React.StrictMode>
    <ErrorBoundary fallback={<CrashFallback />}>
      {view}
    </ErrorBoundary>
  </React.StrictMode>
);
