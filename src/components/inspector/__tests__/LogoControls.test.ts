// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { open } = vi.hoisted(() => ({ open: vi.fn<(opts?: unknown) => Promise<null>>(async () => null) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open }));

import { LogoControls } from '../LogoControls';
import { IMAGE_EXTENSIONS } from '../../../engine/mediaTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  open.mockClear();
});

describe('LogoControls logo picker (B2)', () => {
  it('offers every supported image extension, including webp', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const noop = () => {};
    act(() => {
      root!.render(createElement(LogoControls, {
        logo: undefined, logoPosition: 'top-right', logoOpacity: 1,
        header: { show: false, text: '' }, footer: { show: false, text: '', show_slide_number: false }, toc: { numbered: true },
        onLogoChange: noop, onLogoPositionChange: noop, onLogoOpacityChange: noop,
        onHeaderChange: noop, onFooterChange: noop, onTocChange: noop,
      } as never));
    });
    const button = host.querySelector('button') as HTMLButtonElement;
    await act(async () => { button.click(); });

    expect(open).toHaveBeenCalledTimes(1);
    const { filters } = (open.mock.calls[0] as unknown as [{ filters: { extensions: string[] }[] }])[0];
    const exts = filters.flatMap((f) => f.extensions);
    expect(exts).toContain('webp');
    expect(new Set(exts)).toEqual(new Set(IMAGE_EXTENSIONS));
  });
});
