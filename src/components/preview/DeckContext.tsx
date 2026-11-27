// Deck-wide render inputs shared by every SlideRenderer host: the resolved
// theme, the document's title/author/date (header and footer templates) and
// the aspect ratio. Provided once by App (and by AudienceApp for the audience
// window) instead of being threaded through ThumbnailPanel, the presentation
// overlays and OffscreenDeck as props.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_THEME, type Theme } from '../../engine/theme';
import { parseAspectRatio, type AspectRatio } from '../../engine/types';

export interface DeckContextValue {
  theme: Theme;
  docTitle: string;
  docAuthor: string;
  docDate: string;
  aspectRatio: AspectRatio;
}

/** What a renderer sees with no provider: the default theme, 16:9, no meta. */
export const DEFAULT_DECK: DeckContextValue = {
  theme: DEFAULT_THEME,
  docTitle: '',
  docAuthor: '',
  docDate: '',
  aspectRatio: parseAspectRatio(),
};

const DeckContext = createContext<DeckContextValue>(DEFAULT_DECK);

export function DeckProvider({ value, children }: { value: DeckContextValue; children: ReactNode }) {
  return <DeckContext.Provider value={value}>{children}</DeckContext.Provider>;
}

export function useDeck(): DeckContextValue {
  return useContext(DeckContext);
}

/**
 * A stable DeckContextValue for a provider: a new object only when one of its fields
 * changes, so memoised consumers (thumbnails) don't re-render on unrelated
 * parent renders.
 */
export function useDeckContextValue(
  theme: Theme, docTitle: string, docAuthor: string, docDate: string, aspectRatio: AspectRatio,
): DeckContextValue {
  return useMemo(
    () => ({ theme, docTitle, docAuthor, docDate, aspectRatio }),
    [theme, docTitle, docAuthor, docDate, aspectRatio],
  );
}
