// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { parseDocument } from '../../../engine/parser/markdownToSlides';
import { SlideRenderer } from '../SlideRenderer';

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
