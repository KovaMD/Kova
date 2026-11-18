import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  TRANSITION_XML,
  applyFadeTransition,
  applyPptxPostProcessing,
  buildClickPar,
  buildSetBehaviour,
  buildTimingXml,
  makeAnimIdCounter,
  makeStepRegistrar,
  stepShapeName,
} from '../timing';
import type { StepTarget } from '../context';

// Direct unit tests of the timing helpers. The end-to-end behaviour through
// exportToPptx lives in stepTiming.test.ts beside this file.

const AREA = { x: 0.5, y: 1.25, w: 9, h: 4 };

describe('applyFadeTransition', () => {
  it('inserts the fade transition just before </p:sld>', () => {
    expect(applyFadeTransition('<p:sld><p:cSld/></p:sld>'))
      .toBe(`<p:sld><p:cSld/>${TRANSITION_XML}</p:sld>`);
  });

  it('leaves a slide that already has a transition untouched', () => {
    const xml = '<p:sld><p:transition/></p:sld>';
    expect(applyFadeTransition(xml)).toBe(xml);
  });
});

describe('stepShapeName', () => {
  it('encodes the kind and the area origin in thousandths of an inch', () => {
    expect(stepShapeName(AREA, 'img')).toBe('kova:step-img-500-1250');
  });
});

describe('makeStepRegistrar', () => {
  it('hands out distinct names per shape and registers each with the step', () => {
    const targets: StepTarget[] = [];
    const { stepName, registerStep } = makeStepRegistrar(2, AREA, 'code', targets);
    const a = stepName();
    const b = stepName();
    expect(a).toBe('kova:step-code-0-500-1250');
    expect(b).toBe('kova:step-code-1-500-1250');
    registerStep(a);
    registerStep(b);
    expect(targets).toEqual([{ step: 2, objectName: a }, { step: 2, objectName: b }]);
  });

  it('returns no name and registers nothing for an unstepped element', () => {
    const targets: StepTarget[] = [];
    const { stepName, registerStep } = makeStepRegistrar(undefined, AREA, 'callout', targets);
    const name = stepName();
    expect(name).toBeUndefined();
    registerStep(name);
    expect(targets).toEqual([]);
  });
});

describe('makeAnimIdCounter', () => {
  it('counts up from 1, independently per counter', () => {
    const a = makeAnimIdCounter();
    const b = makeAnimIdCounter();
    expect([a(), a(), a()]).toEqual([1, 2, 3]);
    expect(b()).toBe(1);
  });
});

describe('buildSetBehaviour', () => {
  it('targets a whole shape when no range is given', () => {
    const xml = buildSetBehaviour(makeAnimIdCounter(), { spid: 7 });
    expect(xml).toContain('<p:spTgt spid="7"/>');
    expect(xml).toContain('<p:cTn id="1" dur="1" fill="hold">');
    expect(xml).toContain('<p:strVal val="visible"/>');
  });

  it('targets a paragraph range when one is given', () => {
    const xml = buildSetBehaviour(makeAnimIdCounter(), { spid: 7, range: [3, 3] });
    expect(xml).toContain('<p:spTgt spid="7"><p:txEl><p:pRg st="3" end="3"/></p:txEl></p:spTgt>');
  });
});

describe('buildClickPar', () => {
  it('wraps every target in one clickEffect with ids in document order', () => {
    const xml = buildClickPar(makeAnimIdCounter(), [{ spid: 4 }, { spid: 5 }]);
    expect(xml.match(/nodeType="clickEffect"/g)?.length).toBe(1);
    expect(xml.match(/<p:set>/g)?.length).toBe(2);
    const ids = [...xml.matchAll(/<p:cTn id="(\d+)"/g)].map((m) => Number(m[1]));
    expect(ids).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('buildTimingXml', () => {
  it('emits one click per step and a build list only for paragraph builds', () => {
    const xml = buildTimingXml(makeAnimIdCounter(), [[1, [{ spid: 4, range: [0, 0] }]], [2, [{ spid: 5 }]]], [4]);
    expect(xml.startsWith('<p:timing>')).toBe(true);
    expect(xml.match(/nodeType="clickEffect"/g)?.length).toBe(2);
    expect(xml).toContain('<p:bldLst><p:bldP spid="4" grpId="0"/></p:bldLst>');
  });

  it('omits the build list when there are no paragraph builds', () => {
    const xml = buildTimingXml(makeAnimIdCounter(), [[1, [{ spid: 5 }]]], []);
    expect(xml).not.toContain('<p:bldLst>');
  });
});

describe('applyPptxPostProcessing', () => {
  async function roundTrip(slides: string[], targets: StepTarget[][]): Promise<string[]> {
    const zip = new JSZip();
    slides.forEach((xml, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, xml));
    const out = await applyPptxPostProcessing(await zip.generateAsync({ type: 'base64' }), targets);
    const back = await JSZip.loadAsync(out, { base64: true });
    return Promise.all(slides.map((_, i) => back.file(`ppt/slides/slide${i + 1}.xml`)!.async('string')));
  }

  it('adds the transition to an unstepped slide and no timing tree', async () => {
    const [xml] = await roundTrip(['<p:sld></p:sld>'], [[]]);
    expect(xml).toContain('<p:transition');
    expect(xml).not.toContain('<p:timing>');
  });

  it('resolves step names to shape ids, strips the names and appends timing after the transition', async () => {
    const slide = '<p:sld><p:cNvPr id="9" name="kova:step-img-0-0"/></p:sld>';
    const [xml] = await roundTrip([slide], [[{ step: 1, objectName: 'kova:step-img-0-0' }]]);
    expect(xml).toContain('<p:cNvPr id="9" name=""/>');
    expect(xml).not.toContain('kova:step');
    expect(xml).toContain('<p:spTgt spid="9"/>');
    expect(xml.indexOf('<p:transition')).toBeLessThan(xml.indexOf('<p:timing>'));
  });

  it('still strips names but skips timing when no target resolves', async () => {
    const slide = '<p:sld><p:cNvPr id="9" name="kova:step-img-0-0"/></p:sld>';
    const [xml] = await roundTrip([slide], [[{ step: 1, objectName: 'kova:step-other' }]]);
    expect(xml).not.toContain('kova:step');
    expect(xml).not.toContain('<p:timing>');
  });
});
