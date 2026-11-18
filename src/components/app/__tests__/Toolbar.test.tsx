// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { Toolbar, type ToolbarProps } from '../Toolbar';

function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
  const props: ToolbarProps = {
    filePath: '/docs/talk.md',
    isDirty: false,
    isRenaming: false,
    renameValue: '',
    onRenameStart: vi.fn(),
    onRenameChange: vi.fn(),
    onRenameCommit: vi.fn(),
    onRenameCancel: vi.fn(),
    canPresent: true,
    onPresent: vi.fn(),
    focusMode: false,
    focusModeCombo: 'Ctrl+Shift+F',
    onToggleFocusMode: vi.fn(),
    showInspector: false,
    onToggleInspector: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  const result = renderWithProviders(<Toolbar {...props} />);
  return { ...result, props };
}

describe('Toolbar', () => {
  it('renders the document title and dirty marker', () => {
    renderToolbar({ isDirty: true });
    expect(screen.getByText('talk.md *')).toBeTruthy();
  });

  it('wires the icon buttons to their callbacks', async () => {
    const { user, props } = renderToolbar();
    const buttons = screen.getAllByRole('button');
    // Present, focus mode, inspector, settings
    expect(buttons).toHaveLength(4);
    await user.click(buttons[1]);
    await user.click(buttons[2]);
    await user.click(buttons[3]);
    expect(props.onToggleFocusMode).toHaveBeenCalledOnce();
    expect(props.onToggleInspector).toHaveBeenCalledOnce();
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it('keeps the icon SVG markup unchanged', () => {
    const { container } = renderToolbar();
    const svgs = Array.from(container.querySelectorAll('svg')).map((s) => s.outerHTML);
    expect(svgs).toHaveLength(3);
    expect(svgs).toMatchSnapshot();
  });
});
