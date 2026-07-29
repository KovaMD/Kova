import { describe, it, expect } from 'vitest';
import { assembleInteractiveDocument } from '../exportPdfNative';

describe('assembleInteractiveDocument (issue #220)', () => {
  const html = assembleInteractiveDocument({
    css: '.slide-frame { color: red; }',
    slideHtml: ['<div class="slide">One</div>', '<div class="slide">Two</div>', '<div class="slide">Three</div>'],
    slideW: 960,
    slideH: 540,
    background: '#112233',
  });

  it('emits a single-viewport deck with one active slide', () => {
    expect(html).toContain('class="kova-deck-slide is-active"');
    expect(html.match(/class="kova-deck-slide"/g)?.length ?? 0).toBe(2);
    expect(html).toContain('id="kova-deck"');
    expect(html).toContain('1 / 3');
  });

  it('includes keyboard and fullscreen navigation script', () => {
    expect(html).toContain('ArrowRight');
    expect(html).toContain('ArrowLeft');
    expect(html).toContain('requestFullscreen');
    expect(html).toContain("e.key === 'f'");
    expect(html).toContain('kova-counter');
  });

  it('keeps print CSS so the file remains printable', () => {
    expect(html).toContain('@media print');
    expect(html).toContain('page-break-after');
  });

  it('inlines caller CSS and slide markup', () => {
    expect(html).toContain('.slide-frame { color: red; }');
    expect(html).toContain('<div class="slide">Two</div>');
    expect(html).toContain('#112233');
  });

  it('is not a multi-page print dump (no kova-page stack)', () => {
    expect(html).not.toContain('kova-page');
  });
});

describe('assembleInteractiveDocument build-reveal (issue #92)', () => {
  const html = assembleInteractiveDocument({
    css: '.sl-step-item--pending { opacity: 0; }',
    slideHtml: ['<div class="slide">One</div>', '<div class="slide">Two</div>'],
    slideW: 960,
    slideH: 540,
    slideSteps: [[1, 2], []],
  });

  it('serialises the per-slide step values', () => {
    expect(html).toContain('var slideSteps = [[1,2],[]];');
  });

  it('advances the step count before the slide index in next()/prev()', () => {
    expect(html).toMatch(/function next\(\) \{[\s\S]*?if \(step < count\)[\s\S]*?show\(i \+ 1, 0\);[\s\S]*?\}/);
    expect(html).toMatch(/function prev\(\) \{[\s\S]*?if \(step > 0\)[\s\S]*?show\(i - 1, \(slideSteps\[i - 1\] \|\| \[\]\)\.length\);[\s\S]*?\}/);
  });

  it('toggles the same sl-step-item--pending class the live app already defines', () => {
    expect(html).toContain("classList.toggle('sl-step-item--pending'");
  });

  it('defaults to an empty step array per slide when slideSteps is omitted, matching old behaviour', () => {
    const noSteps = assembleInteractiveDocument({
      css: '',
      slideHtml: ['<div>One</div>', '<div>Two</div>'],
      slideW: 960,
      slideH: 540,
    });
    expect(noSteps).toContain('var slideSteps = [[],[]];');
  });
});
