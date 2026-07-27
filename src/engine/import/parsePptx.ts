import JSZip from 'jszip';
import { invoke } from '@tauri-apps/api/core';

// ── OOXML namespace URIs ──────────────────────────────────────────────────────

const A   = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P   = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R   = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Placeholder types we care about
type PhType = 'ctrTitle' | 'title' | 'subTitle' | 'body' | 'obj' | 'ftr' | 'hdr' | 'sldNum' | 'dt' | 'other';

export interface PptxBlock {
  kind: 'ctrTitle' | 'title' | 'body' | 'image' | 'table';
  // text blocks
  text?: string;
  isMultiPara?: boolean;
  // image blocks
  assetFilename?: string;  // saved filename relative to destDir, e.g. "assets/slide1_img1.png"
  // table blocks
  headers?: string[];
  rows?: string[][];
  // position (0–1 normalised to slide dimensions, used for layout hints)
  normX: number;
  normY: number;
  normW: number;
  normH: number;
}

export interface PptxParsedSlide {
  blocks: PptxBlock[];
  speakerNotes: string;
}

export interface PptxParseResult {
  slides: PptxParsedSlide[];
  presentationTitle: string;
  warnings: string[];
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function qAll(node: Element | Document, ns: string, local: string): Element[] {
  return Array.from(node.getElementsByTagNameNS(ns, local));
}

function q(node: Element | Document, ns: string, local: string): Element | null {
  return node.getElementsByTagNameNS(ns, local)[0] ?? null;
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

// ── Base64 helpers ────────────────────────────────────────────────────────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Text extraction from txBody ───────────────────────────────────────────────

// Return whether the txBody's lstStyle declares a bullet at the given indent level.
// Most real PPTX body placeholders inherit bullet formatting from the slide layout/master
// and don't repeat it on each paragraph; this covers the common case where the txBody
// itself carries the default via lstStyle.
function lstStyleHasBullet(txBody: Element, lvl: number): boolean {
  const lstStyle = txBody.getElementsByTagNameNS(A, 'lstStyle')[0] ?? null;
  if (!lstStyle) return false;
  const levelTags = ['lvl1pPr', 'lvl2pPr', 'lvl3pPr', 'lvl4pPr', 'lvl5pPr', 'lvl6pPr', 'lvl7pPr', 'lvl8pPr', 'lvl9pPr'];
  const lvlEl = lstStyle.getElementsByTagNameNS(A, levelTags[lvl] ?? levelTags[0])[0] ?? null;
  if (!lvlEl) return false;
  if (lvlEl.getElementsByTagNameNS(A, 'buNone')[0]) return false;
  return !!(lvlEl.getElementsByTagNameNS(A, 'buChar')[0] ?? lvlEl.getElementsByTagNameNS(A, 'buAutoNum')[0]);
}

function extractTextBody(txBody: Element): { text: string; isMultiPara: boolean } {
  const paragraphs = qAll(txBody, A, 'p');
  const lines: string[] = [];
  for (const para of paragraphs) {
    // Collect text by walking child nodes in order (preserves run sequence)
    let lineText = '';
    for (const child of Array.from(para.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      if (el.localName === 'r') {
        const t = el.getElementsByTagNameNS(A, 't')[0];
        if (t?.textContent) lineText += t.textContent;
      } else if (el.localName === 'br') {
        lineText += '\n';
      }
    }

    const trimmed = lineText.trim();
    if (!trimmed) continue;

    const pPr = para.getElementsByTagNameNS(A, 'pPr')[0] ?? null;
    const buChar = pPr?.getElementsByTagNameNS(A, 'buChar')[0];
    const buAutoNum = pPr?.getElementsByTagNameNS(A, 'buAutoNum')[0];
    const buNone = pPr?.getElementsByTagNameNS(A, 'buNone')[0];
    const lvl = pPr ? (parseInt(pPr.getAttribute('lvl') ?? '0') || 0) : 0;
    // A paragraph is a bullet if it has an explicit bullet marker, or if the txBody's
    // lstStyle declares a bullet at this level and there's no explicit buNone override.
    const isBullet = buNone == null && (buChar != null || buAutoNum != null || lstStyleHasBullet(txBody, lvl));

    if (isBullet) {
      lines.push('  '.repeat(lvl) + '- ' + trimmed);
    } else {
      lines.push(trimmed);
    }
  }

  return { text: lines.join('\n'), isMultiPara: lines.length > 1 };
}

// ── Relationship file parser ──────────────────────────────────────────────────

function parseRels(relsXml: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const rel of Array.from(relsXml.getElementsByTagName('Relationship'))) {
    const id     = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) map.set(id, target);
  }
  return map;
}

// ── Slide shape offset / extent (in EMUs) ────────────────────────────────────

interface ShapeGeom { x: number; y: number; cx: number; cy: number }

function getShapeGeom(shape: Element): ShapeGeom {
  // sp/pic shapes carry their transform as a:xfrm inside spPr. A graphicFrame
  // (table/chart/SmartArt) instead carries it as its own direct p:xfrm child
  // — wrong namespace for the a:xfrm lookup, so without this fallback every
  // graphicFrame silently fell through to the (0,0)/1x1 default below.
  const xfrm = shape.getElementsByTagNameNS(A, 'xfrm')[0]
    ?? shape.getElementsByTagNameNS(P, 'xfrm')[0]
    ?? null;
  if (!xfrm) return { x: 0, y: 0, cx: 1, cy: 1 };
  const off = xfrm.getElementsByTagNameNS(A, 'off')[0];
  const ext = xfrm.getElementsByTagNameNS(A, 'ext')[0];
  return {
    x:  parseInt(off?.getAttribute('x')  ?? '0') || 0,
    y:  parseInt(off?.getAttribute('y')  ?? '0') || 0,
    cx: parseInt(ext?.getAttribute('cx') ?? '1') || 1,
    cy: parseInt(ext?.getAttribute('cy') ?? '1') || 1,
  };
}

// When a shape lives inside a p:grpSp, its coordinates are relative to the
// group's child coordinate system, not the slide. Walk up to any ancestor
// grpSp elements and compose their transforms to get slide coordinates.
function getComposedGeom(shape: Element): ShapeGeom {
  let { x, y, cx, cy } = getShapeGeom(shape);
  let parent: Element | null = shape.parentElement;
  while (parent && parent.localName !== 'spTree') {
    if (parent.localName === 'grpSp') {
      const grpSpPr = Array.from(parent.children).find((c) => c.localName === 'grpSpPr');
      const xfrm = grpSpPr ? Array.from(grpSpPr.children).find((c) => c.localName === 'xfrm') : undefined;
      if (xfrm) {
        const offEl   = Array.from(xfrm.children).find((c) => c.localName === 'off');
        const extEl   = Array.from(xfrm.children).find((c) => c.localName === 'ext');
        const chOffEl = Array.from(xfrm.children).find((c) => c.localName === 'chOff');
        const chExtEl = Array.from(xfrm.children).find((c) => c.localName === 'chExt');
        const gx  = parseInt(offEl?.getAttribute('x')   ?? '0') || 0;
        const gy  = parseInt(offEl?.getAttribute('y')   ?? '0') || 0;
        const gw  = parseInt(extEl?.getAttribute('cx')  ?? '1') || 1;
        const gh  = parseInt(extEl?.getAttribute('cy')  ?? '1') || 1;
        const cox = parseInt(chOffEl?.getAttribute('x') ?? '0') || 0;
        const coy = parseInt(chOffEl?.getAttribute('y') ?? '0') || 0;
        const cew = parseInt(chExtEl?.getAttribute('cx') ?? '1') || 1;
        const ceh = parseInt(chExtEl?.getAttribute('cy') ?? '1') || 1;
        const sx = gw / cew;
        const sy = gh / ceh;
        x  = gx + (x  - cox) * sx;
        y  = gy + (y  - coy) * sy;
        cx = cx * sx;
        cy = cy * sy;
      }
    }
    parent = parent.parentElement;
  }
  return { x, y, cx, cy };
}

function normalise(geom: ShapeGeom, slideW: number, slideH: number) {
  return {
    normX: geom.x / slideW,
    normY: geom.y / slideH,
    normW: geom.cx / slideW,
    normH: geom.cy / slideH,
  };
}

// ── Placeholder type ──────────────────────────────────────────────────────────

function getPhType(sp: Element): PhType | null {
  // getElementsByTagNameNS searches the full descendant subtree, so this
  // already finds a p:ph/a:ph anywhere under sp, including nvSpPr → nvPr → ph.
  const ph = sp.getElementsByTagNameNS(P, 'ph')[0]
          ?? sp.getElementsByTagNameNS(A, 'ph')[0]
          ?? null;
  if (!ph) return null;
  return mapPhType(ph.getAttribute('type') ?? 'body');
}

function mapPhType(t: string): PhType {
  if (t === 'ctrTitle') return 'ctrTitle';
  if (t === 'title')    return 'title';
  if (t === 'subTitle') return 'subTitle';
  if (t === 'body')     return 'body';
  if (t === 'obj')      return 'obj';
  if (t === 'ftr')      return 'ftr';
  if (t === 'hdr')      return 'hdr';
  if (t === 'sldNum')   return 'sldNum';
  if (t === 'dt')       return 'dt';
  return 'other';
}

// p:cNvPr@name is presentationml-only for p:sp/p:pic (no a:cNvPr variant),
// so a single-namespace lookup is enough, unlike the ph/txBody dual lookups above.
function getObjectName(shape: Element): string | null {
  return shape.getElementsByTagNameNS(P, 'cNvPr')[0]?.getAttribute('name') ?? null;
}

// ── Table extraction ──────────────────────────────────────────────────────────

function extractTable(tbl: Element): { headers: string[]; rows: string[][] } | null {
  const allRows = qAll(tbl, A, 'tr');
  if (allRows.length === 0) return null;

  function rowText(tr: Element): string[] {
    return qAll(tr, A, 'tc').map((tc) => {
      const txBody = tc.getElementsByTagNameNS(A, 'txBody')[0];
      if (!txBody) return '';
      const { text } = extractTextBody(txBody);
      return text.replace(/\n/g, ' ').trim();
    });
  }

  const headers = rowText(allRows[0]);
  const rows = allRows.slice(1).map(rowText);
  return { headers, rows };
}

// ── Speaker notes extraction ──────────────────────────────────────────────────

const NOTES_SLIDE_TYPE = 'notesSlide';

async function extractSpeakerNotes(
  slideRels: Map<string, string>,
  slidePath: string,
  zip: JSZip,
): Promise<string> {
  // Find the notesSlide relationship (if any)
  let notesTarget: string | undefined;
  for (const [, target] of slideRels) {
    if (target.includes(NOTES_SLIDE_TYPE)) { notesTarget = target; break; }
  }
  if (!notesTarget) return '';

  const notesZipPath = resolveRelTarget(slidePath.replace(/[^/]+$/, ''), notesTarget);
  const notesXmlText = await zip.file(notesZipPath)?.async('string');
  if (!notesXmlText) return '';

  const notesDoc = parseXml(notesXmlText);
  const spTree = q(notesDoc, P, 'spTree') ?? q(notesDoc, A, 'spTree');
  if (!spTree) return '';

  const lines: string[] = [];
  for (const sp of qAll(spTree, P, 'sp')) {
    // Skip the slide-image placeholder — it has no text
    const phType = getPhType(sp);
    if (phType === 'other' && sp.getElementsByTagNameNS(P, 'ph')[0]?.getAttribute('type') === 'sldImg') continue;
    // Also skip if explicitly typed as sldImg
    const nvPr = sp.getElementsByTagNameNS(P, 'nvPr')[0];
    const ph = nvPr?.getElementsByTagNameNS(P, 'ph')[0];
    if (ph?.getAttribute('type') === 'sldImg') continue;

    // Native footer/header/date/slide-number placeholders inherited from the
    // notes master — page chrome, not notes content.
    if (phType === 'ftr' || phType === 'hdr' || phType === 'sldNum' || phType === 'dt') continue;

    const txBody = sp.getElementsByTagNameNS(P, 'txBody')[0]
                ?? sp.getElementsByTagNameNS(A, 'txBody')[0]
                ?? null;
    if (!txBody) continue;

    const { text } = extractTextBody(txBody);
    const trimmed = text.trim();
    if (trimmed) lines.push(trimmed);
  }

  return lines.join('\n\n');
}

// ── Per-slide block extraction ────────────────────────────────────────────────

async function extractSlideBlocks(
  slideDoc: Document,
  rels: Map<string, string>,
  zip: JSZip,
  slideW: number,
  slideH: number,
  slideIndex: number,
  destDir: string,
  warnings: string[],
  slidePath: string,
<<<<<<< HEAD
  imageCache: Map<string, string>,
  chromeSkipCounts: { kova: number; native: number },
=======
  savedAssetMap: Map<string, string>,
>>>>>>> 0419cab (fix(import): deduplicate extracted PPTX image assets using ZIP path cache)
): Promise<PptxBlock[]> {
  const blocks: PptxBlock[] = [];
  const spTree = q(slideDoc, P, 'spTree') ?? q(slideDoc, A, 'spTree');
  if (!spTree) return blocks;

  let imgCounter = 0;

  // ── Text shapes (p:sp) ────────────────────────────────────────────────────
  for (const sp of qAll(spTree, P, 'sp')) {
    const objectName = getObjectName(sp);
    if (objectName?.startsWith('kova:')) {
      // Kova's own header/footer/slide-number text — regenerated from the
      // current theme on export, not slide content to round-trip.
      chromeSkipCounts.kova++;
      continue;
    }

    const txBody = sp.getElementsByTagNameNS(P, 'txBody')[0]
                ?? sp.getElementsByTagNameNS(A, 'txBody')[0]
                ?? null;
    if (!txBody) continue;

    const { text, isMultiPara } = extractTextBody(txBody);
    if (!text.trim()) continue;

    const geom = getComposedGeom(sp);
    const norm = normalise(geom, slideW, slideH);
    const phType = getPhType(sp);

    if (phType === 'ctrTitle') {
      blocks.push({ kind: 'ctrTitle', text: text.trim(), isMultiPara, ...norm });
    } else if (phType === 'title') {
      blocks.push({ kind: 'title', text: text.trim(), isMultiPara, ...norm });
    } else if (phType === 'ftr' || phType === 'hdr' || phType === 'sldNum' || phType === 'dt') {
      // Native PowerPoint footer/header/date/slide-number placeholders — page
      // chrome, not slide content.
      chromeSkipCounts.native++;
    } else {
      // body / subTitle / obj / textbox / other — all become body blocks
      blocks.push({ kind: 'body', text: text.trim(), isMultiPara, ...norm });
    }
  }

  // ── Pictures (p:pic) ──────────────────────────────────────────────────────
  for (const pic of qAll(spTree, P, 'pic')) {
    const picObjectName = getObjectName(pic);
    if (picObjectName?.startsWith('kova:')) {
      // Kova's own chrome (currently just the theme logo) — regenerated from
      // the current theme on export, not an asset to re-import. Prefix match
      // mirrors the text-shape check above so a future kova:-prefixed
      // picture type is skipped automatically, not silently re-imported.
      chromeSkipCounts.kova++;
      continue;
    }

    const blipFill = pic.getElementsByTagNameNS(P, 'blipFill')[0]
                  ?? pic.getElementsByTagNameNS(A, 'blipFill')[0]
                  ?? null;
    const blip = blipFill?.getElementsByTagNameNS(A, 'blip')[0] ?? null;
    const rId  = blip?.getAttributeNS(R, 'embed') ?? blip?.getAttribute('r:embed') ?? null;
    if (!rId) continue;

    const mediaTarget = rels.get(rId); // e.g. "../media/image1.png"
    if (!mediaTarget) continue;

    // Resolve the media path inside the ZIP.
    // Target is relative to the slide file; derive base from the actual slidePath
    // rather than hardcoding 'ppt/slides/' so non-standard archive layouts work.
    const slideDir = slidePath.replace(/[^/]+$/, '');
    const mediaZipPath = resolveRelTarget(slideDir, mediaTarget);

    const ext = mediaZipPath.split('.').pop()?.toLowerCase() ?? 'png';

    // Skip Windows metafiles — they can't be displayed in WebView
    if (ext === 'wmf' || ext === 'emf') {
      warnings.push(`Slide ${slideIndex + 1}: vector image (.${ext}) skipped — not supported in browser`);
      continue;
    }

    const mediaFile = zip.file(mediaZipPath);
    if (!mediaFile) {
      warnings.push(`Slide ${slideIndex + 1}: could not find media file ${mediaZipPath}`);
      continue;
    }

    imgCounter++;
    const imgBytes = await mediaFile.async('uint8array');
    const hash = await sha256Hex(imgBytes);

    let savedName = imageCache.get(hash);
    if (!savedName) {
      const imgBase64 = uint8ArrayToBase64(imgBytes);
      const suggestedName = `pptx_slide${slideIndex + 1}_img${imgCounter}.${ext}`;
      try {
        savedName = await invoke<string>('write_asset_bytes', {
          data: imgBase64,
          filename: suggestedName,
          destDir,
        });
      } catch (err) {
        warnings.push(`Slide ${slideIndex + 1}: failed to save image — ${err}`);
        continue;
      }
      imageCache.set(hash, savedName);
    }

    const geom = getComposedGeom(pic);
    const norm = normalise(geom, slideW, slideH);
    blocks.push({ kind: 'image', assetFilename: `assets/${savedName}`, ...norm });
  }

  // ── Graphic frames: tables, charts, SmartArt ─────────────────────────────
  for (const gf of qAll(spTree, P, 'graphicFrame')) {
    const graphicData = gf.getElementsByTagNameNS(A, 'graphicData')[0] ?? null;
    if (!graphicData) continue;

    const uri = graphicData.getAttribute('uri') ?? '';

    if (uri.includes('/table')) {
      const tbl = graphicData.getElementsByTagNameNS(A, 'tbl')[0] ?? null;
      if (!tbl) continue;
      const tableData = extractTable(tbl);
      if (!tableData) continue;
      const geom = getComposedGeom(gf);
      const norm = normalise(geom, slideW, slideH);
      blocks.push({ kind: 'table', ...tableData, ...norm });
    } else if (uri.includes('/chart')) {
      warnings.push(`Slide ${slideIndex + 1}: chart skipped — not supported`);
    } else if (uri.includes('/diagram')) {
      // OOXML SmartArt graphicFrames declare this URI (drawingml/2006/diagram);
      // 'SmartArt'/'smartArt' never appears in it, so that never matched a real
      // file — SmartArt silently vanished with no warning instead of this one.
      warnings.push(`Slide ${slideIndex + 1}: SmartArt skipped — not supported`);
    }
  }

  // Sort by vertical position so reading order matches the slide top-to-bottom;
  // break ties by horizontal position (e.g. an image + caption on the same
  // row) rather than falling back to insertion order (text, then pics, then
  // graphicFrames), which doesn't reflect the shapes' actual layout.
  blocks.sort((a, b) => a.normY - b.normY || a.normX - b.normX);

  return blocks;
}

// ── Resolve a relationship Target relative to a base ZIP path ─────────────────

function resolveRelTarget(basePath: string, target: string): string {
  // Absolute ZIP paths (rare but valid in OOXML) — strip leading slash.
  if (target.startsWith('/')) return target.slice(1);
  // Normalise all relative paths (handles both '../' and same-directory cases).
  const parts = (basePath + target).split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '' && part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function parsePptx(filePath: string, destDir: string): Promise<PptxParseResult> {
  const warnings: string[] = [];

  // 1. Read binary via Rust, decode to Uint8Array
  const b64: string = await invoke('read_file_b64', { path: filePath });
  const bytes = base64ToUint8Array(b64);

  // 2. Open as ZIP
  const zip = await JSZip.loadAsync(bytes);

  // 3. Read presentation.xml for slide dimensions + ordered slide list
  const presXmlText = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presXmlText) throw new Error('Not a valid PPTX file (missing ppt/presentation.xml)');
  const presDoc = parseXml(presXmlText);

  const sldSz = q(presDoc, P, 'sldSz');
  const slideW = parseInt(sldSz?.getAttribute('cx') ?? '9144000') || 9144000;
  const slideH = parseInt(sldSz?.getAttribute('cy') ?? '5143500') || 5143500;

  // 4. Read presentation rels to get ordered slide file paths
  const presRelsText = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (!presRelsText) throw new Error('Not a valid PPTX file (missing presentation rels)');
  const presRelsDoc = parseXml(presRelsText);
  const presRels = parseRels(presRelsDoc);

  // sldIdLst gives us the slide order via r:id references
  const sldIdLst = q(presDoc, P, 'sldIdLst');
  const slideRIds = sldIdLst
    ? Array.from(sldIdLst.getElementsByTagNameNS(P, 'sldId'))
        .map((el) => el.getAttributeNS(R, 'id') ?? el.getAttribute('r:id') ?? '')
        .filter(Boolean)
    : [];

  // Fallback: if no sldIdLst, enumerate slide files directly
  const slideZipPaths: string[] = slideRIds.length > 0
    ? slideRIds.map((rId) => {
        const target = presRels.get(rId) ?? '';
        return target.startsWith('/') ? target.slice(1) : `ppt/${target.replace(/^\.\//, '')}`;
      }).filter(Boolean)
    : Object.keys(zip.files)
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
        .sort((a, b) => {
          const na = parseInt(a.match(/\d+/)?.[0] ?? '0');
          const nb = parseInt(b.match(/\d+/)?.[0] ?? '0');
          return na - nb;
        });

  // 5. Parse each slide
  const slides: PptxParsedSlide[] = [];
<<<<<<< HEAD
  const imageCache = new Map<string, string>(); // sha256 hex -> already-saved asset filename
  const chromeSkipCounts = { kova: 0, native: 0 };
=======
  const savedAssetMap = new Map<string, string>();
>>>>>>> 0419cab (fix(import): deduplicate extracted PPTX image assets using ZIP path cache)

  for (let i = 0; i < slideZipPaths.length; i++) {
    const slidePath = slideZipPaths[i];
    const slideFile = zip.file(slidePath);
    if (!slideFile) {
      warnings.push(`Slide ${i + 1}: file ${slidePath} not found in archive`);
      slides.push({ blocks: [], speakerNotes: '' });
      continue;
    }

    const slideXmlText = await slideFile.async('string');
    const slideDoc = parseXml(slideXmlText);

    // Read slide rels for media references
    const relsPath = slidePath.replace(/^(.*\/)([^/]+)$/, '$1_rels/$2.rels');
    const slideRelsText = await zip.file(relsPath)?.async('string');
    const slideRels = slideRelsText ? parseRels(parseXml(slideRelsText)) : new Map<string, string>();

    const blocks = await extractSlideBlocks(
<<<<<<< HEAD
      slideDoc, slideRels, zip, slideW, slideH, i, destDir, warnings, slidePath,
      imageCache, chromeSkipCounts,
=======
      slideDoc, slideRels, zip, slideW, slideH, i, destDir, warnings, slidePath, savedAssetMap,
>>>>>>> 0419cab (fix(import): deduplicate extracted PPTX image assets using ZIP path cache)
    );
    const speakerNotes = await extractSpeakerNotes(slideRels, slidePath, zip);
    slides.push({ blocks, speakerNotes });
  }

  // Extract presentation title from the first slide's ctrTitle or title
  let presentationTitle = '';
  for (const slide of slides) {
    const titleBlock = slide.blocks.find((b) => b.kind === 'ctrTitle' || b.kind === 'title');
    if (titleBlock?.text) {
      presentationTitle = titleBlock.text;
      break;
    }
  }

  // Summarise skipped chrome as at most two lines, rather than one warning per
  // shape — a themed deck can have 4 chrome shapes on every slide, and the
  // import UI's "N items skipped" count would otherwise read as if something
  // went wrong instead of the round-trip cleanly avoiding duplication.
  if (chromeSkipCounts.kova > 0) {
    warnings.push(`Skipped ${chromeSkipCounts.kova} Kova theme element(s) (header/footer/logo) — regenerated from the current theme, not duplicated.`);
  }
  if (chromeSkipCounts.native > 0) {
    warnings.push(`Skipped ${chromeSkipCounts.native} native footer/header/date/slide-number placeholder(s) — not reconstructed on import.`);
  }

  return { slides, presentationTitle, warnings };
}
