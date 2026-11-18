// Vitest setup: mirror src/main.tsx's composition root so engine code that
// relies on the default (installed) ports behaves as it does in the app.
//
// The adapters are imported lazily inside beforeAll, after the test file has
// been collected, so each file's own vi.mock('@tauri-apps/...') factories
// still apply. A static import here would load the real Tauri modules first
// and bypass those mocks. Tests that want in-memory fakes pass them to the
// engine function directly, or call installEnginePorts() themselves.
import { beforeAll } from 'vitest';

beforeAll(async () => {
  const { installTauriEnginePorts } = await import('../platform/enginePorts');
  installTauriEnginePorts();
});
