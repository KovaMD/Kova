// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../exportPptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide } from '../../types';

// jsdom ships no real canvas 2D implementation (no `canvas` npm package), so
// mathToDataUrl's own blank-capture check (isCanvasBlank, which needs a
// *working* getImageData to tell "content was drawn" apart from "nothing
// was drawn, this is just background") can't run against a real canvas here
// either. Stub just enough of CanvasRenderingContext2D — a per-canvas last
// fillStyle, reported back verbatim by getImageData — to drive that check
// deterministically, mirroring the StubImage pattern used elsewhere for
// jsdom's lack of real image decoding.
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const lastFill = new WeakMap<HTMLCanvasElement, [number, number, number]>();
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null;
    const canvas = this;
    return {
      set fillStyle(v: string) { lastFill.set(canvas, hexToRgb(v)); },
      get fillStyle() { return '#000000'; },
      fillRect() { /* no-op: colour is already recorded by the fillStyle setter */ },
      getImageData(_x: number, _y: number, w: number, h: number) {
        const [r, g, b] = lastFill.get(canvas) ?? [255, 255, 255];
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
        return { data };
      },
    };
  };
});
afterAll(() => { HTMLCanvasElement.prototype.getContext = originalGetContext; });

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    // Clearly not DEFAULT_THEME's background (#FFFFFF) — isCanvasBlank must
    // see this as real content, not an empty capture.
    canvas.getContext('2d')!.fillStyle = '#ff00ff';
    canvas.toDataURL = () =>
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    return canvas;
  }),
}));

function mathSlide(): Slide {
  return {
    index: 0,
    raw: '',
    title: 'Equation',
    titleLevel: 2,
    elements: [{ type: 'math', value: 'E = mc^2', display: true }],
    speakerNotes: '',
    references: [],
    layout: 'title-content',
    hidden: false,
  };
}

describe('exportPptx display math (issue #196)', () => {
  it('embeds display math as an image in the PPTX zip', async () => {
    const res = await exportToPptx([mathSlide()], {}, DEFAULT_THEME, 'en');
    const zip = await JSZip.loadAsync(res.base64, { base64: true });
    const media = Object.keys(zip.files).filter((p) => p.startsWith('ppt/media/') && !zip.files[p].dir);
    expect(media.length).toBeGreaterThan(0);
    // Should not fall back to leaving only plain TeX in slide text without media.
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toMatch(/a:blip|p:pic/i);
  });

  it('falls back to the LaTeX source as plain text when the capture is blank (e.g. the WebKit foreignObject issue)', async () => {
    const html2canvas = (await import('html2canvas')).default;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (html2canvas as any).mockImplementationOnce(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 10;
      canvas.height = 10;
      // Never set fillStyle -> getImageData reports pure white, matching
      // DEFAULT_THEME's #FFFFFF background exactly: a genuinely blank capture.
      return canvas;
    });
    const res = await exportToPptx([mathSlide()], {}, DEFAULT_THEME, 'en');
    const zip = await JSZip.loadAsync(res.base64, { base64: true });
    const media = Object.keys(zip.files).filter((p) => p.startsWith('ppt/media/') && !zip.files[p].dir);
    expect(media.length).toBe(0);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string');
    expect(xml).toContain('E = mc^2');
    expect(res.warnings.some((w) => w.includes('Display math could not be rendered'))).toBe(true);
  });
});
