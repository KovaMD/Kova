// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { parseDocument } from '../../../engine/parser/markdownToSlides';
import { ThumbnailPanel } from '../ThumbnailPanel';
import { DEFAULT_THEME } from '../../../engine/theme';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

// jsdom implements neither ResizeObserver nor scrollIntoView.
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => {};
});

const { slides } = parseDocument('# Intro\n\n---\n\n# Agenda\n\n---\n\n# Wrap-up');

// The scaled slide preview inside each thumbnail is pointer-events: none, so
// interact with the thumbnail card that contains the given slide title.
function thumbnail(title: string): HTMLElement {
  const card = screen.getByText(title).closest<HTMLElement>('[data-slide-index]');
  if (!card) throw new Error(`no thumbnail for "${title}"`);
  return card;
}

describe('ThumbnailPanel deck inputs (DeckContext)', () => {
  // The thumbnail's clipping box: the only element sized from the deck's
  // aspect ratio (height = slide height x thumbnail scale).
  function previewBox(title: string): HTMLElement {
    const box = Array.from(thumbnail(title).querySelectorAll<HTMLElement>('div'))
      .find((d) => d.style.overflow === 'hidden' && d.style.position === 'relative');
    if (!box) throw new Error('no preview box');
    return box;
  }

  it('sizes thumbnails from the deck aspect ratio', () => {
    const wide = renderWithProviders(<ThumbnailPanel slides={slides} currentIndex={0} onSelect={vi.fn()} />, { deck: { aspectRatio: { w: 16, h: 9 } } });
    const wideH = parseFloat(previewBox('Intro').style.height);
    wide.unmount();
    renderWithProviders(<ThumbnailPanel slides={slides} currentIndex={0} onSelect={vi.fn()} />, { deck: { aspectRatio: { w: 4, h: 3 } } });
    const squareH = parseFloat(previewBox('Intro').style.height);
    expect(squareH / wideH).toBeCloseTo((3 / 4) / (9 / 16), 1);
  });

  it('renders the deck title into thumbnail footers', () => {
    const theme = { ...DEFAULT_THEME, footer: { show: true, text: '{title}', show_slide_number: false } };
    renderWithProviders(<ThumbnailPanel slides={slides} currentIndex={0} onSelect={vi.fn()} />, { deck: { theme, docTitle: 'Board pack' } });
    expect(screen.getAllByText('Board pack').length).toBe(slides.length);
  });
});

describe('ThumbnailPanel smoke test', () => {
  it('shows an open-file hint when there are no slides', () => {
    renderWithProviders(<ThumbnailPanel slides={[]} currentIndex={0} onSelect={vi.fn()} />);
    expect(screen.getByText('Slides')).toBeTruthy();
    expect(screen.getByText('Open a Markdown file to see slides')).toBeTruthy();
  });

  it('renders a thumbnail per slide and selects one on click', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(<ThumbnailPanel slides={slides} currentIndex={0} onSelect={onSelect} />);
    expect(screen.getByText('Intro')).toBeTruthy();
    expect(screen.getByText('Wrap-up')).toBeTruthy();

    await user.click(thumbnail('Agenda'));
    expect(onSelect).toHaveBeenLastCalledWith(1);
  });

  it('moves to the next slide with ArrowDown once the list has focus', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(<ThumbnailPanel slides={slides} currentIndex={1} onSelect={onSelect} />);
    await user.click(thumbnail('Agenda'));
    onSelect.mockClear();

    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('opens the slide options menu on right-click and duplicates the slide', async () => {
    const onDuplicate = vi.fn();
    const { user } = renderWithProviders(
      <ThumbnailPanel slides={slides} currentIndex={0} onSelect={vi.fn()} onDuplicate={onDuplicate} />,
    );
    await user.pointer({ keys: '[MouseRight]', target: thumbnail('Wrap-up') });
    expect(screen.getByRole('menu', { name: 'Slide options' })).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: 'Duplicate slide' }));
    expect(onDuplicate).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
