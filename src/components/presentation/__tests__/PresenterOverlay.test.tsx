// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { emitTo } from '@tauri-apps/api/event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { parseDocument } from '../../../engine/parser/markdownToSlides';
import { DEFAULT_THEME } from '../../../engine/theme';
import { PresenterOverlay } from '../PresenterOverlay';

vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn(() => Promise.resolve()) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

beforeEach(() => vi.mocked(emitTo).mockClear());

const { slides } = parseDocument(
  '# Welcome\n\n???\n\nGreet the room\n\n---\n\n# Roadmap\n\n---\n\n# Questions',
);

type Props = ComponentProps<typeof PresenterOverlay>;

function renderPresenter(overrides: Partial<Props> = {}) {
  const props: Props = {
    slides,
    currentIndex: 0,
    currentStep: 0,
    theme: DEFAULT_THEME,
    aspectRatio: { w: 16, h: 9 },
    showNextSlide: true,
    showTimer: false,
    notesFontSize: 'md',
    onNavigate: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };
  return { props, ...renderWithProviders(<PresenterOverlay {...props} />) };
}

describe('PresenterOverlay smoke test', () => {
  it('shows the current slide, a preview of the next one and the speaker notes', () => {
    renderPresenter();
    expect(screen.getByText('Welcome')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.getByText('Roadmap')).toBeTruthy();
    expect(screen.getByText('Greet the room')).toBeTruthy();
  });

  it('marks the end of the deck on the last slide', () => {
    renderPresenter({ currentIndex: 2 });
    expect(screen.getByText('End of presentation')).toBeTruthy();
    expect(screen.getByText('No notes for this slide')).toBeTruthy();
  });

  it('advances with the right arrow key', () => {
    const { props } = renderPresenter();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(props.onNavigate).toHaveBeenCalledWith(1, 0);
  });

  it('blanks the audience screen with B', () => {
    renderPresenter();
    fireEvent.keyDown(window, { key: 'b' });
    expect(emitTo).toHaveBeenCalledWith('audience', 'present:blank', { mode: 'black' });
  });

  it('hides the speaker notes from the notes toggle', async () => {
    const { user } = renderPresenter();
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Greet the room')).toBeNull();
  });

  it('exits on Escape', () => {
    const { props } = renderPresenter();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });
});
