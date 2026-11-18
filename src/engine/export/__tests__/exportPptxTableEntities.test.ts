// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '../pptx';
import { DEFAULT_THEME } from '../../theme';
import type { Slide, SlideElement } from '../../types';

// Regression guard: inlineToHtml() (the markdown parser) escapes & < > into
// HTML entities before a table cell reaches the exporter. stripHtml() used to
// only strip tags without decoding those entities back, so "AT&T" round-
// tripped as the literal text "AT&amp;T" in the exported slide XML.

function makeSlide(elements: SlideElement[]): Slide {
  return {
    index: 0, raw: '', title: '', titleLevel: 0,
    elements, speakerNotes: '', references: [], layout: 'default', hidden: false,
  };
}

async function slideXml(slide: Slide): Promise<string> {
  const res = await exportToPptx([slide], {}, DEFAULT_THEME, 'en');
  const zip = await JSZip.loadAsync(res.base64, { base64: true });
  return zip.file('ppt/slides/slide1.xml')!.async('string');
}

describe('exportPptx table cell HTML-entity decoding', () => {
  it('decodes &amp; back to & in table headers and cells', async () => {
    const table: SlideElement = {
      type: 'table',
      headers: ['Company &amp; Co'],
      rows: [['AT&amp;T']],
    };
    const xml = await slideXml(makeSlide([table]));
    // A single-escaped &amp; is correct XML for the literal text "AT&T" —
    // the bug produced a *doubled* escape ("AT&amp;amp;T", i.e. literal
    // "AT&amp;T" once decoded), which would render wrong in PowerPoint.
    expect(xml).toContain('<a:t>AT&amp;T</a:t>');
    expect(xml).not.toContain('&amp;amp;');
  });

  it('decodes &lt; and &gt; back to literal < and > in table cells', async () => {
    const table: SlideElement = {
      type: 'table',
      headers: ['Header'],
      rows: [['a &lt; b &gt; c']],
    };
    const xml = await slideXml(makeSlide([table]));
    // pptxgenjs itself re-escapes '<'/'>' for valid XML output — what matters
    // is that we no longer emit the *doubled* entity from the un-decoded input.
    expect(xml).not.toContain('&amp;lt;');
    expect(xml).not.toContain('&amp;gt;');
  });
});
