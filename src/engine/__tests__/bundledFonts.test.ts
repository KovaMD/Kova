import { describe, it, expect, vi, afterEach } from 'vitest';

type StyleEl = { tagName: string; dataset: Record<string, string>; textContent: string };

type BundledMod = typeof import('../bundledFonts');

function stubDocument() {
  const appended: StyleEl[] = [];
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      const el: StyleEl = { tagName: tag.toUpperCase(), dataset: {}, textContent: '' };
      return el;
    },
    head: {
      appendChild(el: StyleEl) { appended.push(el); },
    },
  });
  return appended;
}

async function freshModule(): Promise<{ mod: BundledMod; styles: StyleEl[] }> {
  const styles = stubDocument();
  vi.resetModules();
  const mod = await import('../bundledFonts');
  return { mod, styles };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BUNDLED_FONT_NAMES', () => {
  it('lists the bundled font families available to themes', async () => {
    const { mod } = await freshModule();
    expect(mod.BUNDLED_FONT_NAMES).toEqual(['Montserrat', 'Kova Icons']);
  });
});

describe('registerBundledFonts', () => {
  it('injects @font-face rules for a known bundled family', async () => {
    const { mod, styles } = await freshModule();
    mod.registerBundledFonts(['Montserrat']);

    expect(styles).toHaveLength(1);
    expect(styles[0].dataset.bundledFont).toBe('Montserrat');
    expect(styles[0].textContent).toContain('@font-face');
    expect(styles[0].textContent).toContain('font-family: "Montserrat"');
    expect(styles[0].textContent).toContain('unicode-range:');
    expect(styles[0].textContent).toContain('/fonts/Montserrat-variable-normal.woff2');
    expect(styles[0].textContent).toContain('/fonts/Montserrat-variable-italic.woff2');
  });

  it('is idempotent — a second call does not inject duplicate rules', async () => {
    const { mod, styles } = await freshModule();
    mod.registerBundledFonts(['Montserrat']);
    mod.registerBundledFonts(['Montserrat']);

    expect(styles).toHaveLength(1);
  });

  it('silently skips unknown family names', async () => {
    const { mod, styles } = await freshModule();
    mod.registerBundledFonts(['NotARealFont']);

    expect(styles).toHaveLength(0);
  });
});
