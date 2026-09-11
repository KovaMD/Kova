import { describe, it, expect, vi, afterEach } from 'vitest';

type FontMod = typeof import('../fontDetect');

type MockCtx = {
  font: string;
  measureText: ReturnType<typeof vi.fn>;
};

function stubCanvas(ctx: MockCtx | null) {
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => ctx,
    }),
  });
}

async function freshModule(ctx: MockCtx | null): Promise<{ mod: FontMod; ctx: MockCtx | null }> {
  stubCanvas(ctx);
  vi.resetModules();
  const mod = await import('../fontDetect');
  return { mod, ctx };
}

function makeCtx(availableFamilies: string[]): MockCtx {
  return {
    font: '',
    measureText: vi.fn(function (this: MockCtx) {
      const differs = availableFamilies.some((f) => this.font.includes(f));
      return { width: differs ? 200 : 100 };
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseFontStack', () => {
  it('splits and unquotes each family', async () => {
    const { mod } = await freshModule(null);
    expect(mod.parseFontStack(`'Clan Pro', Calibri, "Arial", sans-serif`))
      .toEqual(['Clan Pro', 'Calibri', 'Arial', 'sans-serif']);
  });

  it('drops empty entries', async () => {
    const { mod } = await freshModule(null);
    expect(mod.parseFontStack('Inter,,  , sans-serif')).toEqual(['Inter', 'sans-serif']);
  });
});

describe('isGenericFamily', () => {
  it('recognises the CSS generics case-insensitively', async () => {
    const { mod } = await freshModule(null);
    expect(mod.isGenericFamily('sans-serif')).toBe(true);
    expect(mod.isGenericFamily('Monospace')).toBe(true);
    expect(mod.isGenericFamily('system-ui')).toBe(true);
    expect(mod.isGenericFamily('Clan Pro')).toBe(false);
  });
});

describe('isFontAvailable', () => {
  it('returns false when canvas getContext is unavailable', async () => {
    const { mod } = await freshModule(null);
    expect(mod.isFontAvailable('Anything')).toBe(false);
  });

  it('returns true when the primary font measures differently from a generic base', async () => {
    const ctx = makeCtx(['DistinctFont']);
    const { mod } = await freshModule(ctx);
    expect(mod.isFontAvailable('DistinctFont')).toBe(true);
  });

  it('returns false when the primary font matches every generic base width', async () => {
    const ctx = makeCtx([]);
    const { mod } = await freshModule(ctx);
    expect(mod.isFontAvailable('MissingFont')).toBe(false);
  });

  it('treats a bare generic family as available without measuring', async () => {
    const ctx = makeCtx([]);
    const { mod } = await freshModule(ctx);
    expect(mod.isFontAvailable('monospace')).toBe(true);
    expect(ctx.measureText.mock.calls.length).toBe(0);
  });

  it('returns false for an empty value', async () => {
    const { mod } = await freshModule(makeCtx([]));
    expect(mod.isFontAvailable('')).toBe(false);
  });

  it('caches results so repeated checks do not re-measure', async () => {
    const ctx = makeCtx(['CachedFont']);
    const { mod } = await freshModule(ctx);
    expect(mod.isFontAvailable('CachedFont')).toBe(true);
    const callsAfterFirst = ctx.measureText.mock.calls.length;
    expect(mod.isFontAvailable('CachedFont')).toBe(true);
    expect(ctx.measureText.mock.calls.length).toBe(callsAfterFirst);
  });

  it('uses the first comma-separated family and strips surrounding quotes', async () => {
    const ctx = makeCtx(['QuotedFont']);
    const { mod } = await freshModule(ctx);
    expect(mod.isFontAvailable('"QuotedFont", sans-serif')).toBe(true);
    expect(ctx.font.startsWith('14px "QuotedFont"')).toBe(true);
  });
});

describe('isFontStackSatisfied', () => {
  it('is satisfied when any named family in the stack is installed', async () => {
    const ctx = makeCtx(['Arial']);
    const { mod } = await freshModule(ctx);
    expect(mod.isFontStackSatisfied(`'Clan Pro', Calibri, Arial, sans-serif`)).toBe(true);
  });

  it('is satisfied via the OS font list even when the canvas probe misses', async () => {
    const ctx = makeCtx([]); // canvas detects nothing
    const { mod } = await freshModule(ctx);
    expect(mod.isFontStackSatisfied(`'Clan Pro', Calibri, sans-serif`, ['Clan Pro'])).toBe(true);
  });

  it('is satisfied when the stack names only generic families', async () => {
    const ctx = makeCtx([]);
    const { mod } = await freshModule(ctx);
    expect(mod.isFontStackSatisfied('sans-serif')).toBe(true);
  });

  it('is not satisfied when every named family is missing and there is no generic', async () => {
    const ctx = makeCtx([]);
    const { mod } = await freshModule(ctx);
    expect(mod.isFontStackSatisfied(`'Clan Pro', Calibri`, ['Helvetica'])).toBe(false);
  });
});
