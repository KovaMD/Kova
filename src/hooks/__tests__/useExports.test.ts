// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Frontmatter, Slide } from '../../engine/types';
import type { Theme } from '../../engine/theme';
import type { Translator } from '../../i18n';
import type { OffscreenCaptureKind, UseOffscreenCaptureResult } from '../useOffscreenCapture';

// ── Fakes ────────────────────────────────────────────────────────────────────

const ipc = vi.hoisted(() => ({
  writeFileBytes: vi.fn<(path: string, data: string) => Promise<void>>(async () => {}),
  writeFile: vi.fn<(path: string, content: string) => Promise<void>>(async () => {}),
  copyFileWithAssets: vi.fn<(args: unknown) => Promise<void>>(async () => {}),
}));
vi.mock('../../platform/ipc', () => ipc);

const dialog = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);

const engine = vi.hoisted(() => ({
  exportToPptx: vi.fn(),
  exportToPdf: vi.fn(),
  printPresentation: vi.fn(),
  exportPdfNative: vi.fn(),
  buildInteractiveDocument: vi.fn(),
}));
vi.mock('../../engine/export/pptx', () => ({ exportToPptx: engine.exportToPptx }));
vi.mock('../../engine/export/exportPdf', () => ({
  exportToPdf: engine.exportToPdf,
  printPresentation: engine.printPresentation,
}));
vi.mock('../../engine/export/exportPdfNative', () => ({
  exportPdfNative: engine.exportPdfNative,
  buildInteractiveDocument: engine.buildInteractiveDocument,
}));

import { useExports, type UseExportsOptions } from '../useExports';

const slides = (n: number): Slide[] =>
  Array.from({ length: n }, (_, i) => ({ index: i, speakerNotes: '' } as unknown as Slide));

const theme = { id: 'fake' } as unknown as Theme;
const frontmatter = { title: 'Deck' } as Frontmatter;
const aspectRatio = { w: 16, h: 9 };
const t: Translator = (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const elements = [document.createElement('div')];

/** Fake off-screen capture: runs the capture at once against fixed elements. */
function fakeOffscreen(capturing: OffscreenCaptureKind | null = null) {
  return {
    capturing,
    runCapture: vi.fn<UseOffscreenCaptureResult['runCapture']>((_, capture) => capture(elements)),
  };
}

function setup(overrides: Partial<UseExportsOptions> = {}) {
  const offscreen = overrides.offscreen ?? fakeOffscreen();
  const opts: UseExportsOptions = {
    visibleSlides: slides(2),
    frontmatter,
    activeTheme: theme,
    aspectRatio,
    locale: 'en',
    filePath: '/docs/talk.md',
    contentRef: { current: '' },
    t,
    ...overrides,
    offscreen,
  };
  const { result } = renderHook(() => useExports(opts));
  return { result, offscreen };
}

let alertSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  alertSpy.mockRestore();
  errorSpy.mockRestore();
});

// ── PPTX ─────────────────────────────────────────────────────────────────────

describe('useExports: PPTX', () => {
  it('writes the deck to the chosen path, adding .pptx when missing', async () => {
    engine.exportToPptx.mockResolvedValue({ base64: 'UFBUWA==', warnings: [] });
    dialog.save.mockResolvedValue('/out/deck');
    const { result } = setup();
    await act(() => result.current.exportPptx());

    expect(engine.exportToPptx).toHaveBeenCalledWith(slides(2), frontmatter, theme, 'en');
    expect(dialog.save).toHaveBeenCalledWith({
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      defaultPath: '/docs/talk.pptx',
    });
    expect(ipc.writeFileBytes).toHaveBeenCalledWith('/out/deck.pptx', 'UFBUWA==');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('defaults to presentation.pptx for an unsaved document', async () => {
    engine.exportToPptx.mockResolvedValue({ base64: 'x', warnings: [] });
    dialog.save.mockResolvedValue('/out/a.PPTX');
    const { result } = setup({ filePath: null });
    await act(() => result.current.exportPptx());
    expect(dialog.save.mock.calls[0][0].defaultPath).toBe('presentation.pptx');
    expect(ipc.writeFileBytes).toHaveBeenCalledWith('/out/a.PPTX', 'x');
  });

  it('alerts with warnings after a successful export', async () => {
    engine.exportToPptx.mockResolvedValue({ base64: 'x', warnings: ['w1', 'w2'] });
    dialog.save.mockResolvedValue('/out/a.pptx');
    const { result } = setup();
    await act(() => result.current.exportPptx());
    expect(alertSpy).toHaveBeenCalledWith(
      t('app.exportCompleteWithWarnings', { count: 2, warnings: 'w1\nw2' }),
    );
  });

  it('does nothing when the dialog is cancelled', async () => {
    engine.exportToPptx.mockResolvedValue({ base64: 'x', warnings: ['w'] });
    dialog.save.mockResolvedValue(null);
    const { result } = setup();
    await act(() => result.current.exportPptx());
    expect(ipc.writeFileBytes).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('does nothing with no visible slides', async () => {
    const { result } = setup({ visibleSlides: [] });
    await act(() => result.current.exportPptx());
    expect(engine.exportToPptx).not.toHaveBeenCalled();
    expect(dialog.save).not.toHaveBeenCalled();
  });

  it('alerts on failure', async () => {
    engine.exportToPptx.mockResolvedValue({ base64: 'x', warnings: [] });
    dialog.save.mockResolvedValue('/out/a.pptx');
    ipc.writeFileBytes.mockRejectedValueOnce(new Error('disk full'));
    const { result } = setup();
    await act(() => result.current.exportPptx());
    expect(alertSpy).toHaveBeenCalledWith(t('app.pptxExportFailed', { error: 'Error: disk full' }));
  });
});

// ── PDF ──────────────────────────────────────────────────────────────────────

describe('useExports: PDF', () => {
  it('prints natively via the off-screen capture with the given options', async () => {
    engine.exportPdfNative.mockResolvedValue(undefined);
    dialog.save.mockResolvedValue('/out/deck');
    const { result, offscreen } = setup();
    const opts = { perPage: 2, paper: 'a4' as const };
    await act(() => result.current.exportPdf(opts));

    expect(dialog.save).toHaveBeenCalledWith({
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      defaultPath: '/docs/talk.pdf',
    });
    expect(offscreen.runCapture).toHaveBeenCalledTimes(1);
    expect(offscreen.runCapture.mock.calls[0][0]).toEqual(slides(2));
    expect(engine.exportPdfNative).toHaveBeenCalledWith(elements, aspectRatio, '/out/deck.pdf', opts);
    expect(engine.exportToPdf).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('falls back to raster when native fails, and alerts the reason and warnings', async () => {
    engine.exportPdfNative.mockRejectedValue(new Error('no backend'));
    engine.exportToPdf.mockResolvedValue({ base64: 'UERG', warnings: ['w1'] });
    dialog.save.mockResolvedValue('/out/deck.pdf');
    const { result } = setup();
    await act(() => result.current.exportPdf());

    expect(engine.exportToPdf).toHaveBeenCalledWith(elements, theme, aspectRatio);
    expect(ipc.writeFileBytes).toHaveBeenCalledWith('/out/deck.pdf', 'UERG');
    expect(alertSpy).toHaveBeenCalledWith(
      t('app.pdfExportFallback') +
      `\n\n${t('app.pdfExportFallbackReason', { error: 'Error: no backend' })}` +
      '\n\nw1',
    );
  });

  it('alerts when both native and raster fail', async () => {
    engine.exportPdfNative.mockRejectedValue(new Error('no backend'));
    engine.exportToPdf.mockRejectedValue(new Error('raster broke'));
    dialog.save.mockResolvedValue('/out/deck.pdf');
    const { result } = setup();
    await act(() => result.current.exportPdf());
    expect(alertSpy).toHaveBeenCalledWith(t('app.pdfExportFailed', { error: 'Error: raster broke' }));
  });

  it('is a no-op while any capture is in flight', async () => {
    const { result, offscreen } = setup({ offscreen: fakeOffscreen('print') });
    await act(() => result.current.exportPdf());
    expect(dialog.save).not.toHaveBeenCalled();
    expect(offscreen.runCapture).not.toHaveBeenCalled();
  });

  it('does nothing when the dialog is cancelled', async () => {
    dialog.save.mockResolvedValue(null);
    const { result, offscreen } = setup();
    await act(() => result.current.exportPdf());
    expect(offscreen.runCapture).not.toHaveBeenCalled();
  });

  it('runPdfExportCapture reports the outcome instead of alerting', async () => {
    engine.exportPdfNative.mockRejectedValue('nope');
    engine.exportToPdf.mockResolvedValue({ base64: 'b', warnings: ['w'] });
    const { result } = setup();
    let outcome;
    await act(async () => {
      outcome = await result.current.runPdfExportCapture(slides(1), '/cli/out.pdf', {});
    });
    expect(outcome).toEqual({ warnings: ['w'], usedFallback: true, fallbackReason: 'nope' });
    expect(ipc.writeFileBytes).toHaveBeenCalledWith('/cli/out.pdf', 'b');
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

// ── HTML ─────────────────────────────────────────────────────────────────────

describe('useExports: HTML', () => {
  it('writes the interactive document to the chosen path, adding .html', async () => {
    engine.buildInteractiveDocument.mockResolvedValue('<html></html>');
    dialog.save.mockResolvedValue('/out/deck');
    const { result, offscreen } = setup();
    await act(() => result.current.exportHtml());

    expect(dialog.save).toHaveBeenCalledWith({
      filters: [{ name: 'HTML', extensions: ['html'] }],
      defaultPath: '/docs/talk.html',
    });
    expect(offscreen.runCapture.mock.calls[0][2]).toBeUndefined();
    expect(engine.buildInteractiveDocument).toHaveBeenCalledWith(elements, aspectRatio, slides(2));
    expect(ipc.writeFile).toHaveBeenCalledWith('/out/deck.html', '<html></html>');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('alerts on failure', async () => {
    engine.buildInteractiveDocument.mockRejectedValue(new Error('bad'));
    dialog.save.mockResolvedValue('/out/deck.html');
    const { result } = setup();
    await act(() => result.current.exportHtml());
    expect(ipc.writeFile).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(t('app.htmlExportFailed', { error: 'Error: bad' }));
  });

  it('is a no-op while a capture is in flight', async () => {
    const { result } = setup({ offscreen: fakeOffscreen('export') });
    await act(() => result.current.exportHtml());
    expect(dialog.save).not.toHaveBeenCalled();
  });
});

// ── Print ────────────────────────────────────────────────────────────────────

describe('useExports: Print', () => {
  it('prints through a capture tagged print', async () => {
    engine.printPresentation.mockResolvedValue({ warnings: [] });
    const { result, offscreen } = setup();
    await act(() => result.current.print());
    expect(offscreen.runCapture.mock.calls[0][2]).toBe('print');
    expect(engine.printPresentation).toHaveBeenCalledWith(elements, theme, aspectRatio);
    expect(dialog.save).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('alerts with warnings', async () => {
    engine.printPresentation.mockResolvedValue({ warnings: ['w'] });
    const { result } = setup();
    await act(() => result.current.print());
    expect(alertSpy).toHaveBeenCalledWith(t('app.printCompleteWithWarnings', { count: 1, warnings: 'w' }));
  });

  it('logs failures without alerting', async () => {
    engine.printPresentation.mockRejectedValue(new Error('no printer'));
    const { result } = setup();
    await act(() => result.current.print());
    expect(alertSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Print failed:', expect.any(Error));
  });

  it('is a no-op while a capture is in flight or with no slides', async () => {
    const busy = setup({ offscreen: fakeOffscreen('export') });
    await act(() => busy.result.current.print());
    expect(busy.offscreen.runCapture).not.toHaveBeenCalled();
    const empty = setup({ visibleSlides: [] });
    await act(() => empty.result.current.print());
    expect(empty.offscreen.runCapture).not.toHaveBeenCalled();
  });
});

// ── Copy with assets ─────────────────────────────────────────────────────────

describe('useExports: Copy with Assets', () => {
  const doc = [
    '![a](assets/one.png)',
    '![b](assets/one.png)',
    '![web](https://example.com/x.png)',
    '![abs](/etc/passwd)',
    '![up](../secret.png)',
    '![enc](assets/my%20pic.png)',
    '<img src="img/two.jpg" />',
    "<img alt='x' src='data://foo' />",
  ].join('\n');

  it('copies the document with its local relative asset refs', async () => {
    dialog.save.mockResolvedValue('/out/copy');
    const { result } = setup({ contentRef: { current: doc } });
    await act(() => result.current.copyWithAssets());

    expect(dialog.save).toHaveBeenCalledWith({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: '/docs/talk-copy.md',
    });
    expect(ipc.copyFileWithAssets).toHaveBeenCalledWith({
      srcPath: '/docs/talk.md',
      content: doc,
      destPath: '/out/copy.md',
      assetRefs: ['assets/one.png', 'assets/my pic.png', 'img/two.jpg'],
    });
  });

  it('does nothing for an unsaved document or a cancelled dialog', async () => {
    const unsaved = setup({ filePath: null });
    await act(() => unsaved.result.current.copyWithAssets());
    expect(dialog.save).not.toHaveBeenCalled();

    dialog.save.mockResolvedValue(null);
    const cancelled = setup();
    await act(() => cancelled.result.current.copyWithAssets());
    expect(ipc.copyFileWithAssets).not.toHaveBeenCalled();
  });

  it('logs failures without alerting', async () => {
    dialog.save.mockResolvedValue('/out/copy.md');
    ipc.copyFileWithAssets.mockRejectedValueOnce(new Error('denied'));
    const { result } = setup();
    await act(() => result.current.copyWithAssets());
    expect(alertSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('Copy with assets failed:', expect.any(Error));
  });
});
