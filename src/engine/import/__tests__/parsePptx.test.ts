// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// parsePptx reads the file via the read_file_b64 IPC wrapper — mock it to
// hand back a hand-built in-memory PPTX zip instead of touching the filesystem.
// Each wrapper forwards to one command-keyed mock so tests can dispatch on the
// Rust command name.
const mockedInvoke = vi.hoisted(() =>
  vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
);
vi.mock('../../../platform/ipc', () => ({
  readFileB64: (path: string) => mockedInvoke('read_file_b64', { path }),
  writeAssetBytes: (args: Record<string, unknown>) => mockedInvoke('write_asset_bytes', { ...args }),
}));

import JSZip from 'jszip';
import { parsePptx } from '../parsePptx';

beforeEach(() => {
  mockedInvoke.mockReset();
});

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const PRESENTATION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS}>
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`;

const PRESENTATION_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`;

function tableXml(headerText: string, cellText: string): string {
  return `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
    <a:tbl>
      <a:tblGrid><a:gridCol w="1000000"/></a:tblGrid>
      <a:tr h="500000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${headerText}</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      <a:tr h="500000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${cellText}</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
    </a:tbl>
  </a:graphicData></a:graphic>`;
}

// Slide layout (slide is 9144000 x 6858000 EMU):
//  - title, sp shape, at y=0                              -> normY = 0
//  - a standalone (ungrouped) table, at y=4000000          -> normY ~= 0.583
//  - a table nested in a p:grpSp; its OWN xfrm (child-local
//    coordinates) is (0,0), but the group transform places
//    it at composed y=6000000                              -> normY ~= 0.875
// Before the fix: getShapeGeom looked for a:xfrm (wrong namespace for a
// graphicFrame's own p:xfrm), so every table defaulted to (0,0) regardless of
// its real position — both tables would incorrectly sort at/near the top,
// tied with or ahead of the title. The grouped table's raw (0,0) xfrm, if
// read without composing the group transform, would also incorrectly place
// it at the top instead of its real bottom-of-slide position.
const SLIDE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}>
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="1000000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>My Title</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:graphicFrame>
        <p:nvGraphicFramePr>
          <p:cNvPr id="3" name="Table 1"/>
          <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>
          <p:nvPr/>
        </p:nvGraphicFramePr>
        <p:xfrm><a:off x="1000000" y="4000000"/><a:ext cx="3000000" cy="1000000"/></p:xfrm>
        ${tableXml('StandaloneHeader', 'V1')}
      </p:graphicFrame>
      <p:grpSp>
        <p:nvGrpSpPr><p:cNvPr id="4" name="Group 1"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr>
          <a:xfrm>
            <a:off x="500000" y="6000000"/>
            <a:ext cx="2000000" cy="1000000"/>
            <a:chOff x="0" y="0"/>
            <a:chExt cx="1000000" cy="1000000"/>
          </a:xfrm>
        </p:grpSpPr>
        <p:graphicFrame>
          <p:nvGraphicFramePr>
            <p:cNvPr id="5" name="Table 2"/>
            <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>
            <p:nvPr/>
          </p:nvGraphicFramePr>
          <p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:xfrm>
          ${tableXml('GroupedHeader', 'V2')}
        </p:graphicFrame>
      </p:grpSp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

async function buildFixtureBase64(): Promise<string> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', PRESENTATION_XML);
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS);
  zip.file('ppt/slides/slide1.xml', SLIDE_XML);
  return zip.generateAsync({ type: 'base64' });
}

describe('parsePptx table geometry', () => {
  it('positions tables at their real slide coordinates, in and out of a group', async () => {
    const b64 = await buildFixtureBase64();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_b64') return b64;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await parsePptx('/fake/deck.pptx', '/fake/dest');
    expect(result.slides).toHaveLength(1);
    const { blocks } = result.slides[0];

    const kinds = blocks.map((b) => b.kind);
    // Reading order (sorted by normY ascending): title, then the standalone
    // table (~0.58), then the grouped table (~0.87) — proving both (a) the
    // standalone table no longer defaults to normY=0, and (b) the grouped
    // table's position accounts for the enclosing group's transform rather
    // than its raw (0,0) child-local coordinates.
    expect(kinds).toEqual(['title', 'table', 'table']);

    const standalone = blocks.find((b) => b.headers?.[0] === 'StandaloneHeader');
    const grouped = blocks.find((b) => b.headers?.[0] === 'GroupedHeader');
    expect(standalone).toBeDefined();
    expect(grouped).toBeDefined();

    expect(standalone!.normY).toBeCloseTo(4000000 / 6858000, 5);
    expect(grouped!.normY).toBeCloseTo(6000000 / 6858000, 5);
    expect(grouped!.normX).toBeCloseTo(500000 / 9144000, 5);
    expect(grouped!.normW).toBeCloseTo(2000000 / 9144000, 5);
  });
});

// ── Reading-order tie-break ──────────────────────────────────────────────────

// Text (p:sp) and picture (p:pic) shapes are extracted in separate passes —
// text first, then pictures — before a single normY sort. A stable sort
// keeps that pass order for any two blocks at the same normY, so an image on
// the LEFT of same-row text used to come out AFTER it in reading order
// (insertion order) instead of BEFORE it (actual left-to-right position).
const SAME_ROW_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}>
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Caption"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="4572000" y="1000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Right-side caption</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:pic>
        <p:nvPicPr><p:cNvPr id="3" name="Picture 1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId10"/></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="1000000"/><a:ext cx="4000000" cy="1000000"/></a:xfrm></p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
</p:sld>`;

async function buildSameRowFixtureBase64(): Promise<string> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', PRESENTATION_XML);
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS);
  zip.file('ppt/slides/slide1.xml', SAME_ROW_XML);
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' +
    '</Relationships>',
  );
  zip.file('ppt/media/image1.png', 'PNGDATA');
  return zip.generateAsync({ type: 'base64' });
}

describe('parsePptx reading order', () => {
  it('breaks a same-row normY tie by normX, not pass insertion order', async () => {
    const b64 = await buildSameRowFixtureBase64();
    mockedInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'read_file_b64') return b64;
      if (cmd === 'write_asset_bytes') return String(args?.filename);
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await parsePptx('/fake/deck.pptx', '/fake/dest');
    const { blocks } = result.slides[0];
    expect(blocks.map((b) => b.kind)).toEqual(['image', 'body']);
  });
});

// ── Chrome suppression (issue #192) ────────────────────────────────────────────

// One slide tagging its own header/footer text and logo image with Kova's
// 'kova:' objectName prefix (set on export), alongside an ordinary untagged
// textbox that must NOT be affected by the skip.
const CHROME_SLIDE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}>
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="kova:footer-text"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="6500000"/><a:ext cx="9144000" cy="200000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>My Deck | 2026-07-24</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="TextBox 3"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="1000000"/><a:ext cx="9144000" cy="1000000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Ordinary body text</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:pic>
        <p:nvPicPr>
          <p:cNvPr id="4" name="kova:logo"/>
          <p:cNvPicPr/>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill><a:blip r:embed="rIdLogo"/></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="500000" cy="500000"/></a:xfrm></p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
</p:sld>`;

async function buildChromeFixtureBase64(): Promise<string> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', PRESENTATION_XML);
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS);
  zip.file('ppt/slides/slide1.xml', CHROME_SLIDE_XML);
  return zip.generateAsync({ type: 'base64' });
}

describe('parsePptx chrome suppression', () => {
  it('skips kova:-tagged header/footer/logo shapes without writing an asset, keeping ordinary content', async () => {
    const b64 = await buildChromeFixtureBase64();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_b64') return b64;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await parsePptx('/fake/deck.pptx', '/fake/dest');
    const { blocks } = result.slides[0];

    expect(blocks.some((b) => b.text?.includes('My Deck'))).toBe(false);
    expect(blocks.some((b) => b.kind === 'image')).toBe(false);
    expect(blocks.some((b) => b.text === 'Ordinary body text')).toBe(true);
    expect(result.warnings.some((w) => /Skipped 2 Kova theme element/.test(w))).toBe(true);
  });

  it('skips any kova:-prefixed picture, not just the exact literal kova:logo', async () => {
    // The text-shape check has always been a prefix match (startsWith('kova:'));
    // the picture-shape check used to be an exact === 'kova:logo' comparison,
    // so a differently-named kova:-prefixed picture would have been silently
    // re-imported as real content instead of skipped as chrome.
    const zip = new JSZip();
    zip.file('ppt/presentation.xml', PRESENTATION_XML);
    zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS);
    zip.file('ppt/slides/slide1.xml', pictureSlideXml(
      `<p:pic>
        <p:nvPicPr><p:cNvPr id="2" name="kova:watermark"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId10"/></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm></p:spPr>
      </p:pic>`,
    ));
    zip.file('ppt/slides/_rels/slide1.xml.rels', slideRelsXml('rId10', '../media/image1.png'));
    zip.file('ppt/media/image1.png', 'PNGDATA');
    const b64 = await zip.generateAsync({ type: 'base64' });

    mockedInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'read_file_b64') return b64;
      // Must be mocked (not left to throw) so a wrongly-not-skipped image
      // would actually reach a pushed block — otherwise this test would pass
      // vacuously regardless of the chrome check, for the wrong reason.
      if (cmd === 'write_asset_bytes') return String(args?.filename);
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await parsePptx('/fake/deck.pptx', '/fake/dest');
    expect(result.slides[0].blocks.some((b) => b.kind === 'image')).toBe(false);
    expect(result.warnings.some((w) => /Skipped 1 Kova theme element/.test(w))).toBe(true);
  });

  it('skips native ftr/hdr/sldNum/dt placeholders with real text, but not empty inherited ones', async () => {
    const nativePhSlideXml = (footerText: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}>
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Footer Placeholder 2"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="ftr"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="6500000"/><a:ext cx="3000000" cy="200000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${footerText}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Content Placeholder 3"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="body"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="1000000"/><a:ext cx="9144000" cy="1000000"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Real slide content</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

    const presXml2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS}>
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`;
    const presRels2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`;

    const zip = new JSZip();
    zip.file('ppt/presentation.xml', presXml2);
    zip.file('ppt/_rels/presentation.xml.rels', presRels2);
    zip.file('ppt/slides/slide1.xml', nativePhSlideXml('Acme Corp Confidential'));
    zip.file('ppt/slides/slide2.xml', nativePhSlideXml('')); // empty footer, inherited/unfilled
    const b64 = await zip.generateAsync({ type: 'base64' });

    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_b64') return b64;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await parsePptx('/fake/deck.pptx', '/fake/dest');
    expect(result.slides).toHaveLength(2);

    const allText = result.slides.flatMap((s) => s.blocks.map((b) => b.text));
    expect(allText).not.toContain('Acme Corp Confidential');
    expect(allText).toContain('Real slide content');

    // Only the non-empty ftr on slide 1 counts — the empty one on slide 2 must not.
    expect(result.warnings.filter((w) => /Skipped \d+ native/.test(w))).toHaveLength(1);
    expect(result.warnings.some((w) => /Skipped 1 native/.test(w))).toBe(true);
  });
});

// ── Cross-slide image dedup (issue #192) ───────────────────────────────────────

function picXml(rId: string): string {
  return `<p:pic>
    <p:nvPicPr><p:cNvPr id="2" name="Picture 1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="${rId}"/></p:blipFill>
    <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm></p:spPr>
  </p:pic>`;
}

function pictureSlideXml(pic: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}>
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      ${pic}
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function slideRelsXml(rId: string, target: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>
</Relationships>`;
}

async function buildImageDedupFixtureBase64(): Promise<string> {
  const presXml3 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS}>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/><p:sldId id="258" r:id="rId3"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`;
  const presRels3 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide3.xml"/>
</Relationships>`;

  const zip = new JSZip();
  zip.file('ppt/presentation.xml', presXml3);
  zip.file('ppt/_rels/presentation.xml.rels', presRels3);

  // Slide 1 and 2 embed byte-identical content under distinct media paths —
  // mirrors real pptx exports, where each per-slide picture insert gets its
  // own media entry even when the source bytes (e.g. a repeated logo) match.
  zip.file('ppt/slides/slide1.xml', pictureSlideXml(picXml('rId10')));
  zip.file('ppt/slides/_rels/slide1.xml.rels', slideRelsXml('rId10', '../media/imageA.png'));
  zip.file('ppt/media/imageA.png', 'AAAA');

  zip.file('ppt/slides/slide2.xml', pictureSlideXml(picXml('rId10')));
  zip.file('ppt/slides/_rels/slide2.xml.rels', slideRelsXml('rId10', '../media/imageA2.png'));
  zip.file('ppt/media/imageA2.png', 'AAAA');

  // Slide 3 embeds genuinely different content — must NOT be deduped away.
  zip.file('ppt/slides/slide3.xml', pictureSlideXml(picXml('rId10')));
  zip.file('ppt/slides/_rels/slide3.xml.rels', slideRelsXml('rId10', '../media/imageB.png'));
  zip.file('ppt/media/imageB.png', 'BBBB');

  return zip.generateAsync({ type: 'base64' });
}

// ── SmartArt warning (real OOXML URI, not a literal 'SmartArt' substring) ────

const SMARTART_SLIDE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}>
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:graphicFrame>
        <p:nvGraphicFramePr>
          <p:cNvPr id="2" name="Diagram 1"/>
          <p:cNvGraphicFramePr/>
          <p:nvPr/>
        </p:nvGraphicFramePr>
        <p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:xfrm>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">
          <dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId2" r:lo="rId3" r:qs="rId4" r:cs="rId5"/>
        </a:graphicData></a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
</p:sld>`;

async function buildSmartArtFixtureBase64(): Promise<string> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', PRESENTATION_XML);
  zip.file('ppt/_rels/presentation.xml.rels', PRESENTATION_RELS);
  zip.file('ppt/slides/slide1.xml', SMARTART_SLIDE_XML);
  return zip.generateAsync({ type: 'base64' });
}

describe('parsePptx SmartArt', () => {
  it('warns on a real SmartArt graphicFrame (drawingml/2006/diagram URI) instead of silently dropping it', async () => {
    const b64 = await buildSmartArtFixtureBase64();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_b64') return b64;
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await parsePptx('/fake/deck.pptx', '/fake/dest');
    expect(result.warnings.some((w) => w.includes('SmartArt skipped'))).toBe(true);
  });
});

describe('parsePptx image dedup', () => {
  it('reuses the saved filename for byte-identical images, writing distinct-content images separately', async () => {
    const b64 = await buildImageDedupFixtureBase64();
    const writtenFilenames: string[] = [];
    mockedInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'read_file_b64') return b64;
      if (cmd === 'write_asset_bytes') {
        const filename = String(args?.filename);
        writtenFilenames.push(filename);
        return filename;
      }
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const result = await parsePptx('/fake/deck.pptx', '/fake/dest');
    expect(result.slides).toHaveLength(3);

    // One write for the "AAAA" content, one for "BBBB" — the second "AAAA"
    // occurrence (slide 2) is deduped and never reaches write_asset_bytes.
    expect(writtenFilenames).toHaveLength(2);

    const img1 = result.slides[0].blocks.find((b) => b.kind === 'image');
    const img2 = result.slides[1].blocks.find((b) => b.kind === 'image');
    const img3 = result.slides[2].blocks.find((b) => b.kind === 'image');
    expect(img1?.assetFilename).toBeDefined();
    expect(img2?.assetFilename).toBe(img1?.assetFilename);
    expect(img3?.assetFilename).not.toBe(img1?.assetFilename);
  });
});
