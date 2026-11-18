import { enginePorts, type AssetLoader } from '../../ports';
import type { Slide, Frontmatter } from '../../types';
import { parseAspectRatio } from '../../types';
import type { Theme } from '../../theme';
import { resolveDeckMeta, resolveSlideFrame } from '../../render/slideModel';
import type { DeckMeta, SlideFrame } from '../../render/slideModel';
import type { PptxSlide } from './pptxTypes';
import { cssColorToHex, hex } from './colour';
import type { SlideRenderContext, StepTarget } from './context';
import { applyPptxPostProcessing } from './timing';
import { resolveSlideImages, resolveThemeLogo } from './assets';
import { FOOT_H, HEAD_H, M, W } from './geometry';
import { tryAddImage } from './elements/image';
import { addFooterBar, addHeaderBar, addLogo, addReferences } from './chrome';
import { renderLayout } from './layouts';

// ── Entry point ───────────────────────────────────────────────────────────────

export interface ExportResult { base64: string; warnings: string[] }

export async function exportToPptx(
  slides: Slide[],
  frontmatter: Frontmatter,
  theme: Theme,
  locale: string,
  assets: AssetLoader = enginePorts().assets,
): Promise<ExportResult> {
  // Lazy-loaded: pptxgenjs is only needed once a PPTX export is actually
  // triggered, and shouldn't add weight to the app's initial bundle.
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pres = new PptxGenJS();
  // Same ratio parsing as the preview, PDF and presenter, so every output
  // agrees. Width is fixed at W=10", height follows the ratio: 16:9 → 5.625",
  // 4:3 → 7.5", 16:10 → 6.25".
  const ratio = parseAspectRatio(frontmatter.aspect_ratio as string | undefined);
  const H = (W * ratio.h) / ratio.w;
  // LAYOUT_16x9 = 10" × 5.625" and LAYOUT_4x3 = 10" × 7.5" match W=10 above.
  // LAYOUT_WIDE is 13.33" × 7.5" — using that with W=10 would misplace everything.
  // pptxgenjs has no 10" × 6.25" built-in, so 16:10 gets a custom layout.
  if (ratio.w === 4 && ratio.h === 3) {
    pres.layout = 'LAYOUT_4x3';
  } else if (ratio.w === 16 && ratio.h === 10) {
    pres.defineLayout({ name: 'KOVA_16x10', width: W, height: H });
    pres.layout = 'KOVA_16x10';
  } else {
    pres.layout = 'LAYOUT_16x9';
  }

  const deckMeta = resolveDeckMeta(frontmatter, slides, locale);
  const warnings: string[] = [];

  const { logoDataUrl, logoAr } = await resolveThemeLogo(theme, assets);

  const resolvedSlides = await resolveSlideImages(slides, theme, warnings, assets);
  const perSlideStepTargets: StepTarget[][] = [];

  for (let i = 0; i < resolvedSlides.length; i++) {
    const pSlide: PptxSlide = pres.addSlide();
    const stepTargets: StepTarget[] = [];
    const position = { slideNumber: i + 1, totalSlides: slides.length };
    addSlide(pSlide, resolvedSlides[i], theme, deckMeta, position, H, warnings, logoDataUrl, logoAr, stepTargets);
    perSlideStepTargets.push(stepTargets);
  }

  const rawBase64 = (await pres.write({ outputType: 'base64' })) as string;
  const base64 = await applyPptxPostProcessing(rawBase64, perSlideStepTargets);
  return { base64, warnings };
}

// ── Per-slide dispatcher ──────────────────────────────────────────────────────

function addSlide(
  s: PptxSlide, slide: Slide, t: Theme, deckMeta: DeckMeta,
  position: { slideNumber: number; totalSlides: number }, H: number, warnings: string[],
  logoDataUrl: string | null, logoAr: number | null, stepTargets: StepTarget[] = [],
) {
  const frame: SlideFrame = resolveSlideFrame(slide, t, deckMeta, position);
  const hasHead = frame.header.visible;
  const hasFoot = frame.footer.visible;
  const cy = M + (hasHead ? HEAD_H : 0);
  const ch = H - M - cy - (hasFoot ? FOOT_H : 0);

  // Bar-left accent stripe: drawn first so it sits behind all content.
  if (t.layout.decoration === 'bar-left') {
    s.addShape('rect', {
      x: 0, y: 0, w: 0.07, h: H,
      fill: { color: hex(t.colors.accent) },
      line: { type: 'none' },
    });
  }

  // Per-slide text colour may be a named colour (`white`, Marp `_color: white`)
  // or a functional notation (`rgb(...)`). PptxGenJS only accepts 6-digit hex,
  // so convert any CSS colour to hex before it reaches the layout renderers —
  // otherwise pptxgenjs silently falls back to black (DEF_FONT_COLOR).
  // Which layouts honour the invert code background: see layouts/index.ts.
  const { colours } = frame;
  const ctx: SlideRenderContext = {
    s, slide, theme: t,
    area: { x: M, y: cy, w: W - M * 2, h: ch },
    slideH: H,
    colours: {
      text: cssColorToHex(colours.text),
      heading: cssColorToHex(colours.heading),
      bold: cssColorToHex(colours.bold),
      codeBg: colours.codeBgOverride,
    },
    warnings,
    steps: stepTargets,
  };

  if (slide.backgroundImage) {
    const ar = slide.backgroundImage.size === 'contain' ? slide.backgroundImage.aspectRatio : undefined;
    tryAddImage(s, slide.backgroundImage.src, { x: 0, y: 0, w: W, h: H }, warnings, ar);
  }

  renderLayout(ctx);

  if (hasHead) addHeaderBar(s, t, frame.header.segments);
  if (hasFoot) addFooterBar(s, t, frame.footer, H);
  if (logoDataUrl && frame.logo.placement !== 'hidden') {
    addLogo(s, logoDataUrl, logoAr, frame.logo.position, frame.logo.opacity, H);
  }
  if (slide.references.length > 0) addReferences(ctx, hasFoot);
  if (slide.speakerNotes) s.addNotes(slide.speakerNotes);
}
