import type { SlideElement } from '../../../types';
import type { ElementRenderContext } from '../context';
import type { TextRunBuilder } from './textRuns';

/** A table of contents as text-box runs. Mirrors TocElement: only top-level
 *  entries are numbered or bolded, deeper ones are indented 2em per level
 *  (issue #277). pptxgenjs only indents bulleted paragraphs, so sub-entries
 *  carry an invisible (no-break space) bullet whose indent sets the text
 *  position. */
export function appendTocRuns(
  ctx: ElementRenderContext, b: TextRunBuilder, el: Extract<SlideElement, { type: 'toc' }>,
) {
  const t = ctx.theme;
  const subBase = t.toc.numbered ? 27 : 0; // pptxgenjs' default numbered-text indent, pt
  let n = el.numberStart ?? 0;
  el.entries.forEach((entry) => {
    const depth = entry.depth ?? 0;
    b.startParagraph(el.step);
    b.runs.push({
      text: entry.title,
      options: {
        ...(t.toc.numbered && !depth
          ? { bullet: { type: 'number', numberType: 'arabicPeriod', numberStartAt: ++n } }
          : {}),
        ...(depth
          ? { bullet: { characterCode: '00A0', indent: subBase + depth * 36 } }
          : el.nested ? { bold: true } : {}),
        fontSize: 18, paraSpaceAfter: 4, breakLine: true,
      },
    });
  });
}
