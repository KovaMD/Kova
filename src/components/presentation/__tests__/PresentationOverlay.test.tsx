// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { ComponentProps } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { parseDocument } from '../../../engine/parser/markdownToSlides';
import { DEFAULT_THEME } from '../../../engine/theme';
import { PresentationOverlay } from '../PresentationOverlay';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

const { slides } = parseDocument(
  '# Welcome\n\n???\n\nGreet the room\n\n---\n\n# Roadmap\n\n---\n\n# Questions',
);

type Props = ComponentProps<typeof PresentationOverlay>;

function renderOverlay(overrides: Partial<Props> = {}) {
  const props: Props = {
    slides,
    currentIndex: 0,
    currentStep: 0,
    onNavigate: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };
  return { props, ...renderWithProviders(<PresentationOverlay {...props} />, { deck: { theme: DEFAULT_THEME } }) };
}

function press(key: string) {
  fireEvent.keyDown(window, { key });
}

describe('PresentationOverlay smoke test', () => {
  it('shows the current slide and its position in the deck', () => {
    renderOverlay();
    expect(screen.getByText('Welcome')).toBeTruthy();
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getByText('Slide 1 of 3')).toBeTruthy();
  });

  it('advances with the right arrow and goes back with the left arrow', () => {
    const { props } = renderOverlay({ currentIndex: 1 });
    press('ArrowRight');
    expect(props.onNavigate).toHaveBeenLastCalledWith(2, 0);
    press('ArrowLeft');
    expect(props.onNavigate).toHaveBeenLastCalledWith(0, 0);
  });

  it('navigates with the HUD buttons', async () => {
    const { props, user } = renderOverlay();
    expect((screen.getByTitle('Previous (←)') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByTitle('Next (→ / Space)'));
    expect(props.onNavigate).toHaveBeenCalledWith(1, 0);
  });

  it('toggles speaker notes with N', () => {
    renderOverlay();
    expect(screen.queryByText('Greet the room')).toBeNull();
    press('n');
    expect(screen.getByText('Greet the room')).toBeTruthy();
  });

  it('exits on Escape', () => {
    const { props } = renderOverlay();
    press('Escape');
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });
});
