import { useState, useEffect } from 'react';
import { ModalShell, ModalCloseButton } from './ModalShell';
import type { AppSettings } from '../store/settings';
import type { Theme } from '../engine/theme';
import { useT } from '../i18n';
import type { CategoryId } from './settings/types';
import { AppearanceSection } from './settings/sections/AppearanceSection';
import { LanguageSection } from './settings/sections/LanguageSection';
import { WorkspaceSection } from './settings/sections/WorkspaceSection';
import { PresentationSection } from './settings/sections/PresentationSection';
import { UpdatesSection } from './settings/sections/UpdatesSection';
import { AboutSection } from './settings/sections/AboutSection';
import './settings/SettingsModal.css';

// ── Main modal ────────────────────────────────────────────────────────────────
// Each section stays mounted and gates its own items through inView(), so
// section-local state (update check result, learned-words list) survives
// switching categories, as it did when everything lived in this component.

interface Props {
  settings: AppSettings;
  availableUpdate: string | null;
  allThemes: Theme[];
  isDirty: boolean;
  scrollToUpdates?: boolean;
  onChange: (s: AppSettings) => void;
  onUpdateChecked: (tag: string | null) => void;
  onClose: () => void;
}

export function SettingsModal({ settings, availableUpdate, allThemes, isDirty, scrollToUpdates, onChange, onUpdateChecked, onClose }: Props) {
  const t = useT();
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    onChange({ ...settings, [key]: value });

  const CATEGORIES: { id: CategoryId; label: string }[] = [
    { id: 'appearance',   label: t('settings.sectionAppearance') },
    { id: 'language',     label: t('settings.sectionLanguageSpelling') },
    { id: 'workspace',    label: t('settings.sectionWorkspace') },
    { id: 'presentation', label: t('settings.sectionPresentation') },
    { id: 'updates',      label: t('settings.sectionUpdates') },
    { id: 'about',        label: t('settings.sectionAbout') },
  ];

  const [activeCategory, setActiveCategory] = useState<CategoryId>(scrollToUpdates ? 'updates' : 'appearance');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Category-mode: only the active category's items render. Search mode:
  // every item that matches (by its own label/description text, or by
  // category name) renders regardless of category, so results surface from
  // wherever they actually live.
  function inView(category: CategoryId, searchText: string): boolean {
    if (!searching) return activeCategory === category;
    const categoryLabel = CATEGORIES.find((c) => c.id === category)?.label ?? '';
    return `${searchText} ${categoryLabel}`.toLowerCase().includes(q);
  }

  useEffect(() => {
    if (scrollToUpdates) setActiveCategory('updates');
  }, [scrollToUpdates]);

  const [aboutView, setAboutView] = useState<'main' | 'licenses'>('main');

  return (
    <ModalShell
      onClose={onClose}
      width={700}
      ariaLabel={t('modals.settingsTitle')}
      cardStyle={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'min(620px, 85vh)', overflow: 'hidden' }}
    >
        {/* Header */}
        <div className="settings-header">
          <h2 className="settings-title">{t('modals.settingsTitle')}</h2>
          <ModalCloseButton onClick={onClose} />
        </div>

        <div className="settings-body">

          {/* Category rail */}
          <nav className="settings-nav">
            <div className="settings-search-wrap">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('settings.searchPlaceholder')}
                className="settings-search"
              />
            </div>
            {CATEGORIES.map((cat) => {
              const active = !searching && activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => { setActiveCategory(cat.id); setQuery(''); setAboutView('main'); }}
                  className={`settings-nav-item${active ? ' settings-nav-item--active' : ''}`}
                >
                  {cat.label}
                </button>
              );
            })}
          </nav>

          {/* Category content */}
          <div className="settings-content">
            {!searching && (
              <div className="settings-category-heading">
                {CATEGORIES.find((c) => c.id === activeCategory)?.label}
              </div>
            )}

            <AppearanceSection settings={settings} set={set} inView={inView} allThemes={allThemes} />
            <LanguageSection settings={settings} set={set} inView={inView} />
            <WorkspaceSection settings={settings} set={set} inView={inView} />
            <PresentationSection settings={settings} set={set} inView={inView} />
            <UpdatesSection
              settings={settings} set={set} inView={inView}
              availableUpdate={availableUpdate} isDirty={isDirty} onUpdateChecked={onUpdateChecked}
            />
            <AboutSection inView={inView} searching={searching} aboutView={aboutView} setAboutView={setAboutView} />

          </div>
        </div>
    </ModalShell>
  );
}
