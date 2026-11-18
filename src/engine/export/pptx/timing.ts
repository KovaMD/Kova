// Build-step timing and OOXML post-processing for the PPTX export: the fade
// slide transition, click-triggered build animations, and the single JSZip
// pass that patches both into the generated slide XML.
import JSZip from 'jszip';
import type { Area, StepTarget } from './context';

// PptxGenJS has no API for slide transitions, so the fade used between slides in
// presentation mode (PresentationOverlay.tsx) is applied by patching the generated
// OOXML directly — "Fade Through Black" is the closest built-in PowerPoint transition
// to that black fade-overlay effect.
export const TRANSITION_XML =
  '<p:transition spd="fast" p14:dur="300" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">' +
  '<p:fade thruBlk="1"/>' +
  '</p:transition>';

export function applyFadeTransition(xml: string): string {
  if (xml.includes('<p:transition')) return xml;
  return xml.replace('</p:sld>', `${TRANSITION_XML}</p:sld>`);
}

// ── Native click-triggered build animations (progressive reveal, issue #92) ──
//
// PptxGenJS has no animation API at all (unlike the fade transition above,
// there's no existing single-purpose helper to lean on) — this builds the
// OOXML animation timing tree by hand and patches it into each slide's XML via
// the same JSZip post-processing technique as applyFadeTransitions.
//
// IMPORTANT: the exact <p:timing> shape below is written from documented
// knowledge of the OOXML DrawingML animation schema (ECMA-376), not verified
// against a real "PowerPoint (or LibreOffice) round-trip" — this sandbox's
// headless LibreOffice can't construct animation objects (they hang; a
// sandbox/environment limitation, not a code bug), so there was no way to
// generate a known-good reference file to diff against here. Before this
// ships, open an exported .pptx containing a stepped slide in real PowerPoint
// and/or LibreOffice Impress and confirm it opens cleanly (no repair dialog)
// and the builds actually click through in the expected order. The riskiest
// specific detail is the `presetID="1"` on the click effect — that's cosmetic
// (it only affects how PowerPoint's own Animation Pane *labels* the effect,
// e.g. "Appear" vs "Custom"), the actual reveal behaviour comes entirely from
// the <p:set>/style.visibility toggle, so a labelling mismatch would not be a
// "needs repair" failure — but it's the piece most worth double-checking.
//
// Scope: body content that flows through addElements() (title-content, split,
// two-column, three-column, bsp, grid — and 'math' layout, which is really
// just addTitleContentSlide) gets a native animation, and so do the "pulled
// out" images in addTitleImageSlide/addSplitSlide and the code/diagram block
// in addCodeSlide, which sit beside addElements() rather than going through
// it but still register their own stepTargets. Two single-purpose layouts
// remain genuinely out of scope: addQuoteSlide's hero quote and
// addMediaSlide's video/poll embeds. A `<!-- step -->` on one of those still
// parses and still gates the live preview/presentation/interactive-HTML
// export, it just exports to PPTX unanimated (visible immediately, same as
// before this feature existed), rather than erroring. A real but explicitly
// bounded v1 scope gap, not a silent bug.
//
// CONFIRMED (real-world testing, not just the disclosure above): a single
// <p:set> targeting a *wide* paragraph range — <p:pRg st="X" end="Y"> with
// Y>X, which this code used to emit for adjacent bullets/paragraphs sharing
// one step — only reliably revealed paragraph X; Y stayed visible from the
// start. Two independent repros: a step shared by two adjacent list items
// (the second stayed visible), and a callout's title+body (both part of one
// stepped element, sharing one shape — the body stayed visible while the
// title animated). Fix: never emit a range wider than one paragraph: every
// index gets its own <p:set>, batched onto the same click as sibling
// behaviours under one clickEffect instead of merged into one target's
// <p:pRg>. See the `range: [idx, idx]` comment in applyStepAnimations.

// A shape only needs an objectName when it actually has a stepped target —
// area coordinates are already unique per addElements() call within one
// slide (different panes/columns never share an x/y), so reusing them here
// avoids threading a separate counter through the whole layout call graph.
export function stepShapeName(area: Area, kind: string): string {
  return `kova:step-${kind}-${Math.round(area.x * 1000)}-${Math.round(area.y * 1000)}`;
}

// Shared by addCalloutBlock and addCodeBlock below — both render as several
// separate pptxgenjs shapes (background/bar/title/body; outer/lang-badge/
// inner/text) that all need to reveal together on one click. `stepName()`
// hands out a fresh, distinct objectName per call (or undefined when the
// element isn't stepped at all, so callers skip the objectName option
// entirely); `registerStep()` pushes it onto stepTargets once pptxgenjs has
// actually used it.
export function makeStepRegistrar(step: number | undefined, area: Area, kind: string, stepTargets: StepTarget[]) {
  let shapeCount = 0;
  return {
    stepName: (): string | undefined => step === undefined ? undefined : stepShapeName(area, `${kind}-${shapeCount++}`),
    registerStep: (objectName: string | undefined) => {
      if (objectName) stepTargets.push({ step: step!, objectName });
    },
  };
}

// OOXML timing node ids only need to be unique within one slide's <p:timing>
// tree — reset per slide in applyStepAnimations.
export function makeAnimIdCounter(): () => number {
  let n = 0;
  return () => ++n;
}

// One click's target: a specific paragraph range within a shared text box
// (bullets sharing one shape) when `range` is set, otherwise an entire shape
// (an image that already has its own shape).
export interface ClickTarget { spid: number; range?: [number, number] }

// One "become visible on this click" behaviour. `nextId` is called for this
// node's own id only — callers allocate ids for everything *around* it first,
// so the whole tree's ids come out in strictly increasing, top-down document
// order (matching real PowerPoint output; ids only need to be unique to be
// valid, but keeping them in traversal order is the safer, closer-to-spec choice
// given this schema is hand-authored rather than tool-verified — see the scope
// note above applyStepAnimations).
export function buildSetBehaviour(nextId: () => number, target: ClickTarget): string {
  const tgt = target.range
    ? `<p:spTgt spid="${target.spid}"><p:txEl><p:pRg st="${target.range[0]}" end="${target.range[1]}"/></p:txEl></p:spTgt>`
    : `<p:spTgt spid="${target.spid}"/>`;
  return (
    `<p:set>` +
      `<p:cBhvr>` +
        `<p:cTn id="${nextId()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>` +
        `<p:tgtEl>${tgt}</p:tgtEl>` +
        `<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>` +
      `</p:cBhvr>` +
      `<p:to><p:strVal val="visible"/></p:to>` +
    `</p:set>`
  );
}

// One click's worth of targets — usually a single one, more than one when
// several elements share an explicit `<!-- step: N -->` group and so should
// all reveal together on the same click.
export function buildClickPar(nextId: () => number, targets: ClickTarget[]): string {
  const clickId  = nextId();
  const subId    = nextId();
  const effectId = nextId();
  const behaviours = targets.map((target) => buildSetBehaviour(nextId, target));
  return (
    `<p:par><p:cTn id="${clickId}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>` +
      `<p:childTnLst>` +
        `<p:par><p:cTn id="${subId}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
          `<p:childTnLst>` +
            `<p:par><p:cTn id="${effectId}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">` +
              `<p:stCondLst><p:cond delay="0"/></p:stCondLst>` +
              `<p:childTnLst>${behaviours.join('')}</p:childTnLst>` +
            `</p:cTn></p:par>` +
          `</p:childTnLst>` +
        `</p:cTn></p:par>` +
      `</p:childTnLst>` +
    `</p:cTn></p:par>`
  );
}

// The full per-slide <p:timing> tree: a root -> mainSeq sequence whose
// children are one click-triggered <p:par> per distinct step value, in
// ascending order. `buildSpids` (text shapes with a per-paragraph build only —
// see the call site) get a matching <p:bldLst> entry, mirroring how
// PowerPoint itself declares a placeholder's paragraphs as an animation build.
export function buildTimingXml(nextId: () => number, clicksByStep: Array<[number, ClickTarget[]]>, buildSpids: number[]): string {
  const rootId = nextId();
  const seqId  = nextId();
  const clicks = clicksByStep.map(([, targets]) => buildClickPar(nextId, targets));
  const bldLst = buildSpids.map((id) => `<p:bldP spid="${id}" grpId="0"/>`).join('');
  return (
    `<p:timing><p:tnLst><p:par><p:cTn id="${rootId}" dur="indefinite" restart="never" nodeType="tmRoot">` +
      `<p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="${seqId}" dur="indefinite" nodeType="mainSeq">` +
        `<p:childTnLst>${clicks.join('')}</p:childTnLst>` +
      `</p:cTn></p:seq></p:childTnLst>` +
    `</p:cTn>` +
    `<p:condLst><p:cond evt="onBegin" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:condLst>` +
    `</p:par></p:tnLst>` +
    (bldLst ? `<p:bldLst>${bldLst}</p:bldLst>` : '') +
    `</p:timing>`
  );
}

// Applies the fade transition (every slide) and, where applicable, the step
// timing tree (only slides with a stepped target) in one JSZip load→edit→
// generate pass rather than two — halves the decode/encode cost of the whole
// archive, which matters once a deck's embedded images/diagrams make it
// multiple MB. Same two string patches, in the same order (transition before
// timing, matching how the two used to run as separate sequential passes),
// just applied to each slide's XML once instead of round-tripping the archive
// twice.
export async function applyPptxPostProcessing(base64: string, perSlideTargets: StepTarget[][]): Promise<string> {
  const zip = await JSZip.loadAsync(base64, { base64: true });
  for (let i = 0; i < perSlideTargets.length; i++) {
    const targets = perSlideTargets[i];
    const path = `ppt/slides/slide${i + 1}.xml`;
    const file = zip.file(path);
    if (!file) continue;
    let xml = await file.async('string');
    xml = applyFadeTransition(xml);

    if (targets.length === 0) { zip.file(path, xml); continue; }

    // Resolve each kova:step-* objectName to its real shape id, then strip
    // the placeholder name back to empty — PowerPoint doesn't need a name on
    // these shapes, and leaking an internal "kova:" marker into the shape
    // list / alt-text would be a rough edge for anyone editing the file.
    const spidByName = new Map<string, number>();
    xml = xml.replace(/<p:cNvPr id="(\d+)" name="(kova:step-[^"]*)"/g, (_m, id: string, name: string) => {
      spidByName.set(name, Number(id));
      return `<p:cNvPr id="${id}" name=""`;
    });

    const byStep = new Map<number, ClickTarget[]>();
    const buildSpids = new Set<number>(); // text shapes with a per-paragraph build only
    for (const target of targets) {
      const spid = spidByName.get(target.objectName);
      // Shouldn't happen (every pushed target came from a shape we just gave
      // this exact name), but skip rather than emit a dangling shape reference.
      if (spid === undefined) continue;
      // One <p:set> per individual paragraph index, even when several are
      // contiguous or share the same step — deliberately never collapsed
      // into one multi-paragraph <p:pRg st=X end=Y> (X<Y). Real PowerPoint's
      // own per-paragraph builds only reliably reveal the *first* paragraph
      // of a wide range like that; the rest stay visible from the start (see
      // the scope note above applyStepAnimations). Multiple single-paragraph
      // targets inside the same clickEffect below still all fire together on
      // one click, without that ambiguity.
      const clickTargets: ClickTarget[] = target.paragraphs
        ? target.paragraphs.map((idx): ClickTarget => ({ spid, range: [idx, idx] }))
        : [{ spid }];
      if (target.paragraphs) buildSpids.add(spid);
      byStep.set(target.step, [...(byStep.get(target.step) ?? []), ...clickTargets]);
    }
    // Still write back — even in this "shouldn't happen" case, xml has
    // already had its kova:step-* names stripped above, and skipping the
    // write here would leak that internal marker into the final file.
    if (byStep.size === 0) { zip.file(path, xml); continue; }

    const clicksByStep = [...byStep.entries()].sort(([a], [b]) => a - b);
    const timing = buildTimingXml(makeAnimIdCounter(), clicksByStep, [...buildSpids]);
    xml = xml.replace('</p:sld>', `${timing}</p:sld>`);
    zip.file(path, xml);
  }
  return zip.generateAsync({ type: 'base64' });
}
