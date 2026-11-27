// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { parseDocument } from '../../../engine/parser/markdownToSlides';
import { SlideRenderer } from '../SlideRenderer';
import { DEFAULT_THEME, type Theme } from '../../../engine/theme';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

const slide = parseDocument('# Quarterly review\n\n- Revenue up\n- [Read the report](https://example.com/report)').slides[0];

describe('SlideRenderer smoke test', () => {
  beforeEach(() => vi.mocked(openUrl).mockClear());

  it('renders the slide heading and body text', () => {
    renderWithProviders(<SlideRenderer slide={slide} />);
    expect(screen.getByText('Quarterly review')).toBeTruthy();
    expect(screen.getByText('Revenue up')).toBeTruthy();
  });

  it('opens a clicked link in the system browser', async () => {
    const { user } = renderWithProviders(<SlideRenderer slide={slide} />);
    await user.click(screen.getByRole('link', { name: 'Read the report' }));
    expect(openUrl).toHaveBeenCalledWith('https://example.com/report');
  });

  it('does not open links from a thumbnail', async () => {
    const { user } = renderWithProviders(<SlideRenderer slide={slide} isThumbnail />);
    await user.click(screen.getByRole('link', { name: 'Read the report' }));
    expect(openUrl).not.toHaveBeenCalled();
  });
});

// ── Characterisation: frame chrome and colour precedence (refactor card P2-02) ──
// Pins the preview's current output with literal expectations, independent of
// the shared slide model, so moving SlideRenderer/themeToVars onto that model
// cannot change what the preview draws.

class StubResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= StubResizeObserver;
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} }) as DOMRect;
}

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const [coverSlide, contentSlide] = parseDocument('# Cover\n\n---\n\n## Heading\n\nplain **boldword**').slides;

function chromeTheme(over: Partial<Theme> = {}): Theme {
  return {
    ...DEFAULT_THEME,
    logo: LOGO,
    logo_position: 'top-left',
    logo_opacity: 0.5,
    header: { show: true, text: 'Left {title} | Mid {author} | R {date} | extra', hide_on_title: false },
    footer: { show: true, text: 'Foot {slide_number}/{total}', show_slide_number: true, hide_on_title: false },
    ...over,
  };
}

function frameOf(container: HTMLElement) {
  const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;
  const frame = q('.slide-frame')!;
  return {
    q,
    frame,
    v: (name: string) => frame.style.getPropertyValue(name),
  };
}

const docMeta = { docTitle: 'T|itle', docAuthor: 'Ada', docDate: '2026-01-02' };

describe('SlideRenderer chrome (characterisation)', () => {
  it('renders header segments split on the template |, never on the doc title', () => {
    const { container } = renderWithProviders(<SlideRenderer slide={contentSlide} slideNumber={3} totalSlides={9} />, { deck: { theme: chromeTheme(), ...docMeta } });
    const { q } = frameOf(container);
    const parts = [...q('.sl-header-text.sl-bar-parts')!.children].map((e) => e.textContent);
    expect(parts).toEqual(['Left T|itle', 'Mid Ada', 'R 2026-01-02 | extra']);
  });

  it('renders single-segment footer text, then the bare slide number', () => {
    const { container } = renderWithProviders(<SlideRenderer slide={contentSlide} slideNumber={3} totalSlides={9} />, { deck: { theme: chromeTheme(), ...docMeta } });
    const { q } = frameOf(container);
    expect(q('.sl-footer-text')!.textContent).toBe('Foot 3/9');
    expect(q('.sl-footer-text')!.classList.contains('sl-bar-parts')).toBe(false);
    expect(q('.sl-slide-num')!.textContent).toBe('3');
  });

  it('omits the slide number without one, or when the theme turns it off', () => {
    const a = renderWithProviders(<SlideRenderer slide={contentSlide} totalSlides={9} />, { deck: { theme: chromeTheme(), ...docMeta } });
    expect(frameOf(a.container).q('.sl-slide-num')).toBeNull();
    a.unmount();
    const off = chromeTheme({ footer: { show: true, text: 'F', show_slide_number: false } });
    const b = renderWithProviders(<SlideRenderer slide={contentSlide} slideNumber={2} totalSlides={9} />, { deck: { theme: off, ...docMeta } });
    expect(frameOf(b.container).q('.sl-slide-num')).toBeNull();
  });

  it('omits empty bar text but keeps the bar', () => {
    const t = chromeTheme({ logo: undefined, header: { show: true, text: ' | ' }, footer: { show: true, text: '', show_slide_number: false } });
    const { container } = renderWithProviders(<SlideRenderer slide={contentSlide} totalSlides={9} />, { deck: { theme: t, ...docMeta } });
    const { q } = frameOf(container);
    expect(q('.sl-header-bar')).not.toBeNull();
    expect(q('.sl-header-text')).toBeNull();
    expect(q('.sl-footer-bar')).not.toBeNull();
    expect(q('.sl-footer-text')).toBeNull();
  });

  it('hide_on_title hides the bar (and its logo) on the title slide only', () => {
    const t = chromeTheme({
      header: { show: true, text: 'H', hide_on_title: true },
      footer: { show: true, text: 'F', show_slide_number: true, hide_on_title: true },
    });
    const cover = renderWithProviders(<SlideRenderer slide={coverSlide} slideNumber={1} totalSlides={9} />, { deck: { theme: t, ...docMeta } });
    const c = frameOf(cover.container);
    expect(c.q('.sl-header-bar')).toBeNull();
    expect(c.q('.sl-footer-bar')).toBeNull();
    expect(c.q('img')).toBeNull();
    cover.unmount();
    const content = renderWithProviders(<SlideRenderer slide={contentSlide} slideNumber={2} totalSlides={9} />, { deck: { theme: t, ...docMeta } });
    const d = frameOf(content.container);
    expect(d.q('.sl-header-bar img.sl-logo')).not.toBeNull();
    expect(d.q('.sl-footer-bar .sl-slide-num')!.textContent).toBe('2');
  });

  it.each([
    ['top-left', 'header', ''],
    ['top-right', 'header', 'auto'],
    ['bottom-left', 'footer', ''],
    ['bottom-right', 'footer', 'auto'],
  ] as const)('logo at %s sits in the %s bar', (pos, bar, marginLeft) => {
    const { container } = renderWithProviders(<SlideRenderer slide={contentSlide} totalSlides={9} />, { deck: { theme: chromeTheme({ logo_position: pos }), ...docMeta } });
    const { q } = frameOf(container);
    const img = q(bar === 'header' ? '.sl-header-bar img.sl-logo' : '.sl-footer-bar img.sl-logo-footer')!;
    expect(img.getAttribute('src')).toBe(LOGO);
    expect(img.style.opacity).toBe('0.5');
    expect(img.style.marginLeft).toBe(marginLeft);
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('logo floats in its corner when the theme has no bar there', () => {
    const t = chromeTheme({ logo_position: 'bottom-right', footer: { show: false, text: '', show_slide_number: false } });
    const { container } = renderWithProviders(<SlideRenderer slide={contentSlide} totalSlides={9} />, { deck: { theme: t, ...docMeta } });
    const { q } = frameOf(container);
    const img = q('img.sl-logo-float')!;
    expect(img.className).toBe('sl-logo-float pos-bottom-right');
    expect(img.style.opacity).toBe('0.5');
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('no logo renders no image', () => {
    const { container } = renderWithProviders(<SlideRenderer slide={contentSlide} totalSlides={9} />, { deck: { theme: chromeTheme({ logo: undefined }), ...docMeta } });
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
});

describe('SlideRenderer colour precedence (characterisation)', () => {
  const t: Theme = {
    ...DEFAULT_THEME,
    header: { show: false, text: '' },
    footer: { show: false, text: '', show_slide_number: false },
    colors: { ...DEFAULT_THEME.colors, text: '#111111', title_text: '#EEEEEE', code_bg: '#F5F5F5' },
  };
  const withHB: Theme = { ...t, colors: { ...t.colors, heading: '#333333', bold: '#444444' } };

  it.each([
    ['plain', t, {}, ['#111111', '#111111', '#111111', '#F5F5F5', '#1a1a1a']],
    ['plain with theme heading/bold', withHB, {}, ['#111111', '#333333', '#444444', '#F5F5F5', '#1a1a1a']],
    ['invert', withHB, { invert: true }, ['#EEEEEE', '#EEEEEE', '#EEEEEE', '#0d1117', '#F0F0F0']],
    ['textColor', withHB, { textColor: '#ABCDEF' }, ['#ABCDEF', '#ABCDEF', '#ABCDEF', '#F5F5F5', '#1a1a1a']],
    ['textColor + invert', withHB, { textColor: '#ABCDEF', invert: true }, ['#ABCDEF', '#ABCDEF', '#ABCDEF', '#F5F5F5', '#1a1a1a']],
  ] as const)('%s', (_n, theme, flags, [text, heading, bold, codeBg, codeText]) => {
    const { container } = renderWithProviders(<SlideRenderer slide={{ ...contentSlide, ...flags }} />, { deck: { theme: theme } });
    const { v, frame } = frameOf(container);
    expect([v('--sl-text'), v('--sl-heading-text'), v('--sl-bold-text'), v('--sl-code-bg'), v('--sl-code-text')])
      .toEqual([text, heading, bold, codeBg, codeText]);
    expect(v('--sl-title-text')).toBe('#EEEEEE');
    // The code scheme follows the theme's code_bg, not the invert override.
    expect(frame.dataset.codeScheme).toBe('light');
  });
});
