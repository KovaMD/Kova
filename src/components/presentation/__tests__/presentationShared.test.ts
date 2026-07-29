// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { formatTime, usePresentationNav, type UsePresentationNavOpts } from '../presentationShared';

// No @testing-library/react in this project, which normally sets this flag —
// silences "not configured to support act()" noise from the manual harness below.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('formatTime', () => {
  it('pads mm:ss under an hour', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(599)).toBe('09:59');
  });

  it('adds h:mm:ss past an hour', () => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3661)).toBe('1:01:01');
  });
});

// No @testing-library/react in this project — drive the hook with a minimal
// manual harness (createRoot + a component that calls the hook and reports
// its return value out) instead of adding a new test dependency.

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof usePresentationNav> | undefined;

function Harness(props: { opts: UsePresentationNavOpts }) {
  latest = usePresentationNav(props.opts);
  return null;
}

function render(opts: UsePresentationNavOpts) {
  act(() => { root.render(createElement(Harness, { opts })); });
}

function key(k: string) {
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
}

function wheel(deltaY: number) {
  act(() => { window.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })); });
}

function baseOpts(overrides: Partial<UsePresentationNavOpts> = {}): UsePresentationNavOpts {
  return {
    total: 5,
    currentIndex: 2,
    currentStep: 0,
    getStepCount: () => 0, // no build-reveal steps by default — matches pre-step behaviour exactly
    onNavigate: vi.fn(),
    onExit: vi.fn(),
    onToggleNotes: vi.fn(),
    onToggleBlankBlack: vi.fn(),
    onToggleBlankWhite: vi.fn(),
    onToggleLaser: vi.fn(),
    ...overrides,
  };
}

describe('usePresentationNav', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); });
    latest = undefined;
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  it('goNext/goPrev respect the total/currentIndex bounds', () => {
    const onNavigate = vi.fn();
    render(baseOpts({ currentIndex: 0, total: 3, onNavigate }));
    latest!.goPrev(); // already at 0 — no-op
    expect(onNavigate).not.toHaveBeenCalled();
    latest!.goNext();
    expect(onNavigate).toHaveBeenCalledWith(1, 0);

    onNavigate.mockClear();
    render(baseOpts({ currentIndex: 2, total: 3, onNavigate }));
    latest!.goNext(); // already at last index — no-op
    expect(onNavigate).not.toHaveBeenCalled();
    latest!.goPrev();
    expect(onNavigate).toHaveBeenCalledWith(1, 0);
  });

  it('arrow/space/page keys navigate; Home/End jump to the ends', () => {
    const onNavigate = vi.fn();
    render(baseOpts({ onNavigate }));
    key('ArrowRight');
    key('ArrowLeft');
    key(' ');
    key('PageDown');
    key('PageUp');
    key('Home');
    key('End');
    expect(onNavigate.mock.calls).toEqual([[3, 0], [1, 0], [3, 0], [3, 0], [1, 0], [0, 0], [4, 0]]);
  });

  it('goNext advances the current slide\'s next pending step before advancing the slide', () => {
    const onNavigate = vi.fn();
    render(baseOpts({ currentIndex: 1, currentStep: 0, getStepCount: () => 2, onNavigate }));
    latest!.goNext();
    expect(onNavigate).toHaveBeenCalledWith(1, 1); // same slide, next step

    onNavigate.mockClear();
    render(baseOpts({ currentIndex: 1, currentStep: 2, getStepCount: () => 2, onNavigate }));
    latest!.goNext();
    expect(onNavigate).toHaveBeenCalledWith(2, 0); // steps exhausted -> next slide, step 0
  });

  it('goPrev reverses through steps before crossing back to the previous slide', () => {
    const onNavigate = vi.fn();
    render(baseOpts({ currentIndex: 1, currentStep: 2, getStepCount: () => 2, onNavigate }));
    latest!.goPrev();
    expect(onNavigate).toHaveBeenCalledWith(1, 1); // same slide, previous step
  });

  it('goPrev crossing a slide boundary lands on the previous slide\'s last (fully revealed) step', () => {
    const onNavigate = vi.fn();
    const getStepCount = (i: number) => (i === 0 ? 3 : 0);
    render(baseOpts({ currentIndex: 1, currentStep: 0, getStepCount, onNavigate }));
    latest!.goPrev();
    expect(onNavigate).toHaveBeenCalledWith(0, 3);
  });

  it('Escape calls onExit', () => {
    const onExit = vi.fn();
    render(baseOpts({ onExit }));
    key('Escape');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('b/w/l call the respective toggle callbacks', () => {
    const onToggleBlankBlack = vi.fn();
    const onToggleBlankWhite = vi.fn();
    const onToggleLaser = vi.fn();
    render(baseOpts({ onToggleBlankBlack, onToggleBlankWhite, onToggleLaser }));
    key('b');
    key('w');
    key('l');
    expect(onToggleBlankBlack).toHaveBeenCalledTimes(1);
    expect(onToggleBlankWhite).toHaveBeenCalledTimes(1);
    expect(onToggleLaser).toHaveBeenCalledTimes(1);
  });

  it('n calls onToggleNotes — the caller decides whether/how to act on it', () => {
    // This is exactly why onToggleNotes is a caller-supplied callback rather
    // than a hook-owned setter: PresentationOverlay only calls setShowNotes
    // when the slide has notes, PresenterOverlay always does — the hook
    // itself is agnostic and just relays the keypress.
    const onToggleNotes = vi.fn();
    render(baseOpts({ onToggleNotes }));
    key('n');
    expect(onToggleNotes).toHaveBeenCalledTimes(1);
  });

  it('digit keys start a jump-input, Enter commits it via onNavigate (1-based to 0-based, clamped)', () => {
    const onNavigate = vi.fn();
    render(baseOpts({ total: 10, currentIndex: 0, onNavigate }));
    expect(latest!.jumpInput).toBeNull();
    key('4');
    expect(latest!.jumpInput).toBe('4');
    key('Enter');
    expect(onNavigate).toHaveBeenCalledWith(3, 0); // slide "4" -> index 3
    expect(latest!.jumpInput).toBeNull();
  });

  it('clamps an out-of-range jump to the last slide', () => {
    const onNavigate = vi.fn();
    render(baseOpts({ total: 5, currentIndex: 0, onNavigate }));
    key('9');
    key('Enter');
    expect(onNavigate).toHaveBeenCalledWith(4, 0);
  });

  it('Enter with no pending jump input does not call onNavigate', () => {
    const onNavigate = vi.fn();
    render(baseOpts({ onNavigate }));
    key('Enter');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('wheel navigates and debounces rapid events within 300ms', () => {
    const onNavigate = vi.fn();
    render(baseOpts({ currentIndex: 2, onNavigate }));
    wheel(10); // down -> next
    wheel(-10); // immediately after — debounced, ignored
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(3, 0);
  });

  it('calls resetIdle on key and wheel navigation when supplied, and tolerates it being omitted', () => {
    const resetIdle = vi.fn();
    const onNavigate = vi.fn();
    render(baseOpts({ onNavigate, resetIdle }));
    key('ArrowRight');
    expect(resetIdle).toHaveBeenCalledTimes(1);
    wheel(10);
    expect(resetIdle).toHaveBeenCalledTimes(2);

    // PresenterOverlay doesn't pass resetIdle at all — must not throw.
    render(baseOpts({ onNavigate }));
    expect(() => key('ArrowRight')).not.toThrow();
  });

  it('ignores keydowns targeting a focused text input (e.g. an unrelated form field)', () => {
    const onNavigate = vi.fn();
    render(baseOpts({ onNavigate }));
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    expect(onNavigate).not.toHaveBeenCalled();
    input.remove();
  });
});
