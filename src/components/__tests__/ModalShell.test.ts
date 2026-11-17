// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import { ModalShell } from '../ModalShell';

// Testing Library's automatic cleanup (enabled by `globals: true`) unmounts
// every rendered tree and removes its container after each test.

function pressEscape() {
  fireEvent.keyDown(window, { key: 'Escape', bubbles: true, cancelable: true });
}

// Each call gets its own container and React root, mirroring two real
// ModalShell instances mounted by different parts of the app (e.g. PDF export
// options, then an unsaved-changes confirm dialog).
function renderInOwnRoot(ui: Parameters<typeof renderWithProviders>[0]) {
  const container = document.body.appendChild(document.createElement('div'));
  return renderWithProviders(ui, { container });
}

describe('ModalShell Escape handling', () => {
  it('closes a single mounted modal on Escape (no regression for the common case)', () => {
    const onClose = vi.fn();
    renderWithProviders(createElement(ModalShell, { onClose }, 'content'));
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only the topmost of two stacked modals closes on a single Escape press', () => {
    const onCloseFirst = vi.fn();
    const onCloseSecond = vi.fn();
    renderInOwnRoot(createElement(ModalShell, { onClose: onCloseFirst }, 'first'));
    renderInOwnRoot(createElement(ModalShell, { onClose: onCloseSecond }, 'second'));

    pressEscape();
    expect(onCloseSecond).toHaveBeenCalledTimes(1);
    expect(onCloseFirst).not.toHaveBeenCalled();
  });

  it('falls through to the next modal down once the topmost unmounts', () => {
    const onCloseFirst = vi.fn();
    const onCloseSecond = vi.fn();
    renderInOwnRoot(createElement(ModalShell, { onClose: onCloseFirst }, 'first'));
    const second = renderInOwnRoot(createElement(ModalShell, { onClose: onCloseSecond }, 'second'));

    second.unmount(); // topmost closes/unmounts

    pressEscape();
    expect(onCloseFirst).toHaveBeenCalledTimes(1);
  });

  it('a dismissOnEscape={false} instance never responds and never blocks the real topmost one', () => {
    const onCloseReal = vi.fn();
    const onCloseNonDismissable = vi.fn();
    renderInOwnRoot(createElement(ModalShell, { onClose: onCloseReal }, 'real'));
    renderInOwnRoot(
      createElement(ModalShell, { onClose: onCloseNonDismissable, dismissOnEscape: false }, 'non-dismissable'),
    );

    pressEscape();
    expect(onCloseNonDismissable).not.toHaveBeenCalled();
    expect(onCloseReal).toHaveBeenCalledTimes(1);
  });
});
