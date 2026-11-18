import type { Theme } from '../../theme';

/** First family of a CSS font stack, unquoted, as pptxgenjs wants it. */
export function firstFont(stack: string): string {
  return stack.split(',')[0].trim().replace(/['"]/g, '');
}

// "Kova Icons" is only the name the app registers its bundled icon font under;
// the font itself is Nerd Fonts' "Symbols Nerd Font". PptxGenJS can't embed
// fonts, so name the public family a recipient can actually install.
const BUNDLED_ICON_FONT = 'Kova Icons';
const PUBLIC_ICON_FONT = 'Symbols Nerd Font';

export function pptxIconFont(t: Theme): string {
  const font = firstFont(t.fonts.icon);
  return font === BUNDLED_ICON_FONT ? PUBLIC_ICON_FONT : font;
}
