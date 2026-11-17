// @vitest-environment jsdom
/**
 * Contract test: the navigation script inlined into exported HTML decks
 * (assembleInteractiveDocument in exportPdfNative.ts) and the live app's
 * usePresentationNav hook must agree on step-before-slide navigation.
 *
 * The duplication is deliberate: the exported script has to be standalone JS
 * with no bundler or React behind it, so the two cannot share code. Instead
 * this test drives both through the same key sequences over the same decks
 * and asserts an identical (slide, step) trace, so neither side can change
 * its behaviour on its own without this failing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { assembleInteractiveDocument } from '../exportPdfNative';
import { usePresentationNav } from '../../../components/presentation/presentationShared';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

// No @testing-library/react in this project; this flag is what it would set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Key = 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End' | ' ' | 'PageDown' | 'PageUp';
type Pos = [slide: number, step: number];

/** Distinct, ascending step values per slide (as getSlideStepValues returns). */
type Deck = number[][];

const noop = () => {};

function press(key: Key) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

// ── Hook side ────────────────────────────────────────────────────────────────

function traceHook(deck: Deck, keys: Key[]): Pos[] {
  let pos: Pos = [0, 0];
  function Harness() {
    const [index, setIndex] = useState(0);
    const [step, setStep] = useState(0);
    pos = [index, step];
    usePresentationNav({
      total: deck.length,
      currentIndex: index,
      currentStep: step,
      getStepCount: (i) => deck[i]?.length ?? 0,
      onNavigate: (i, s) => { setIndex(i); setStep(s); },
      onExit: noop,
      onToggleNotes: noop,
      onToggleBlankBlack: noop,
      onToggleBlankWhite: noop,
      onToggleLaser: noop,
    });
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(createElement(Harness)); });
  const trace: Pos[] = [];
  for (const key of keys) {
    act(() => { press(key); });
    trace.push([...pos]);
  }
  act(() => { root.unmount(); });
  container.remove();
  return trace;
}

// ── Exported HTML script side ────────────────────────────────────────────────

// The inlined script registers listeners it never removes; track them so each
// run can be torn down and not react to the next run's key presses.
const registered: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = [];

afterEach(() => {
  for (const [target, type, fn] of registered.splice(0)) target.removeEventListener(type, fn);
  document.body.innerHTML = '';
});

function runExportedScript(deck: Deck) {
  // One element per step value, so the number revealed on a slide equals the
  // script's internal step counter.
  const slideHtml = deck.map((values, i) =>
    `<div class="slide" data-slide="${i}">` +
    values.map((v) => `<p data-step="${v}">step ${v}</p>`).join('') +
    `</div>`,
  );
  const html = assembleInteractiveDocument({ css: '', slideHtml, slideW: 960, slideH: 540, slideSteps: deck });
  const body = /<body>([\s\S]*?)<script>/.exec(html)?.[1];
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (body === undefined || script === undefined) throw new Error('exported HTML shape changed: no <body>/<script>');
  document.body.innerHTML = body;

  const targets: EventTarget[] = [document, window, document.getElementById('kova-deck')!];
  const originals = targets.map((t) => t.addEventListener);
  targets.forEach((t) => {
    const orig = t.addEventListener;
    t.addEventListener = function (type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
      if (fn) registered.push([t, type, fn]);
      orig.call(t, type, fn, opts);
    };
  });
  try {
    new Function(script)();
  } finally {
    targets.forEach((t, k) => { t.addEventListener = originals[k]; });
  }
}

function readScriptPos(): Pos {
  const active = document.querySelectorAll('.kova-deck-slide.is-active');
  if (active.length !== 1) throw new Error(`expected one active slide, got ${active.length}`);
  const slide = Number(active[0].getAttribute('data-index'));
  const step = active[0].querySelectorAll('[data-step]:not(.sl-step-item--pending)').length;
  return [slide, step];
}

function traceScript(deck: Deck, keys: Key[]): Pos[] {
  runExportedScript(deck);
  const trace: Pos[] = [];
  for (const key of keys) {
    press(key);
    trace.push(readScriptPos());
  }
  return trace;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const R: Key = 'ArrowRight';
const L: Key = 'ArrowLeft';

interface Case { name: string; deck: Deck; keys: Key[] }

const cases: Case[] = [
  {
    name: 'no steps anywhere: plain slide-by-slide',
    deck: [[], [], []],
    keys: [R, R, L, L, L, R],
  },
  {
    name: 'steps on a middle slide are revealed before moving on',
    deck: [[], [1, 2], []],
    keys: [R, R, R, R, L, L, L, L],
  },
  {
    name: 'sparse explicit step values still count as distinct steps',
    deck: [[2, 5, 9], [], [1]],
    keys: [R, R, R, R, L, L, L, R, R, R, L, L],
  },
  {
    name: 'going back across a boundary lands fully revealed',
    deck: [[1, 2, 3], [1], []],
    keys: [R, R, R, R, R, L, L, L, L, L],
  },
  {
    name: 'Home and End jump to step 0 of the first and last slide',
    deck: [[1], [1, 2], [1, 2], []],
    keys: ['End', L, L, 'Home', R, 'End', L, L, L, L, 'Home'],
  },
  {
    name: 'Space / PageDown / PageUp share next and prev',
    deck: [[1, 2], [], [1]],
    keys: [' ', 'PageDown', ' ', 'PageUp', 'PageUp', 'PageDown', 'PageDown'],
  },
  {
    name: 'prev at the very start is a no-op',
    deck: [[1, 2], []],
    keys: [L, L, R, L, L],
  },
  {
    name: 'next past the end of a deck whose last slide has no steps is a no-op',
    deck: [[1], []],
    keys: [R, R, R, R, L],
  },
  {
    name: 'single-slide deck with steps',
    deck: [[1, 2]],
    keys: [R, R, L, L, L],
  },
];

describe('nav contract: exported HTML script vs usePresentationNav', () => {
  it.each(cases)('$name', ({ deck, keys }) => {
    const hook = traceHook(deck, keys);
    const script = traceScript(deck, keys);
    expect(script).toEqual(hook);
  });

  // KNOWN DIVERGENCE (found by this test, left unfixed on purpose: see PRD
  // section 4). Pressing next on the last slide once all its steps are shown:
  //   - usePresentationNav does nothing (stays fully revealed);
  //   - the exported script calls show(i + 1, 0), which clamps the index back
  //     to the last slide but resets step to 0, re-hiding every step.
  // When one side is changed to match the other, this starts passing and
  // it.fails turns it red: move the case into `cases` above at that point.
  it.fails('next past the end of a deck whose last slide has steps', () => {
    const deck: Deck = [[], [1, 2]];
    const keys: Key[] = [R, R, R, R];
    expect(traceScript(deck, keys)).toEqual(traceHook(deck, keys));
  });

  it('the divergence above is exactly the step reset on the last slide', () => {
    const deck: Deck = [[], [1, 2]];
    const keys: Key[] = [R, R, R, R];
    expect(traceHook(deck, keys)).toEqual([[1, 0], [1, 1], [1, 2], [1, 2]]);
    expect(traceScript(deck, keys)).toEqual([[1, 0], [1, 1], [1, 2], [1, 0]]);
  });
});
