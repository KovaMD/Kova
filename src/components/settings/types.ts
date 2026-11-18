import type { AppSettings } from '../../store/settings';

// One id per former Section divider — this is a re-layout of the existing
// groupings behind a sidebar + search, not a re-sort of which setting lives
// where.
export type CategoryId = 'appearance' | 'language' | 'workspace' | 'presentation' | 'updates' | 'about';

/** Props every settings section receives from SettingsModal. */
export interface SectionProps {
  settings: AppSettings;
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  /** Whether an item with this search text should render in `category`. */
  inView: (category: CategoryId, searchText: string) => boolean;
}
