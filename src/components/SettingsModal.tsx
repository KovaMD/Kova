import type { ReactNode } from 'react';
import { useState, useMemo, useEffect, useRef } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ModalShell, ModalCloseButton } from './ModalShell';
import type { AppSettings, PresentationMode, NotesFontSize, LaserColor, StartupBehavior } from '../store/settings';
import { EDITOR_FONT_OPTIONS, LASER_COLOR_OPTIONS } from '../store/settings';
import type { Theme } from '../engine/theme';
import { isFontAvailable } from '../engine/fontDetect';
import { fetchUpdate, canSelfUpdate, restartApp } from '../engine/updater';
import type { AvailableUpdate } from '../engine/updater';
import { APP_VERSION } from '../version';
import { UI_LOCALE_OPTIONS, useT } from '../i18n';
import {
  LANGUAGE_OPTIONS,
  getCustomWords,
  removeCustomWord,
  getCustomWordCount,
} from '../engine/spellcheck/spellChecker';

const THIRD_PARTY_LICENSES: { name: string; license: string; copyright: string }[] = [
  { name: 'CodeMirror',              license: 'MIT',                        copyright: '© Marijn Haverbeke and contributors'      },
  { name: 'highlight.js',            license: 'BSD 3-Clause',               copyright: '© 2006 Ivan Sagalaev'                     },
  { name: 'html-to-image',           license: 'MIT',                        copyright: '© 2017 W.Y.'                              },
  { name: 'IBM Plex Mono',           license: 'SIL Open Font License 1.1', copyright: '© 2017 IBM Corp.'                          },
  { name: 'js-yaml',                 license: 'MIT',                        copyright: '© 2011 Vitaly Puzrin and contributors'    },
  { name: 'jsPDF',                   license: 'MIT',                        copyright: '© 2010 James Hall and contributors'       },
  { name: 'JSZip',                   license: 'MIT / GPL-3.0',              copyright: '© 2009 Stuart Knightley and contributors' },
  { name: 'KaTeX',                   license: 'MIT',                        copyright: '© 2013 Khan Academy and contributors'     },
  { name: 'Mermaid',                 license: 'MIT',                        copyright: '© 2014 Knut Sveidqvist and contributors'  },
  { name: 'Montserrat',              license: 'SIL Open Font License 1.1', copyright: '© 2011 The Montserrat Project Authors'    },
  { name: 'PptxGenJS',               license: 'MIT',                        copyright: '© 2015 Brent Ely'                        },
  { name: 'React',                   license: 'MIT',                        copyright: '© Meta Platforms, Inc.'                  },
  { name: 'react-qr-code',           license: 'MIT',                        copyright: '© 2017 Ross Khanas'                      },
  { name: 'react-resizable-panels',  license: 'MIT',                        copyright: '© 2022 Brian Vaughn'                     },
  { name: 'remark / unified',        license: 'MIT',                        copyright: '© unified collective'                    },
  { name: 'Tauri',                   license: 'MIT / Apache 2.0',           copyright: '© 2017 Tauri Apps Contributors'          },
  { name: 'typo-js',                 license: 'BSD 3-Clause',               copyright: '© Christopher Finke'                     },
  { name: 'Vite',                    license: 'MIT',                        copyright: '© 2019 VoidZero Inc. and Vite contributors' },
];

const INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: '15 sec',  value: 15  },
  { label: '30 sec',  value: 30  },
  { label: '1 min',   value: 60  },
  { label: '5 min',   value: 300 },
];

// ── Shared button group style ─────────────────────────────────────────────────

function groupBtnStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '5px 0', fontSize: 11, borderRadius: 4,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-alt)'}`,
    background: active ? 'var(--accent-bg)' : 'var(--bg-input)',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    cursor: 'pointer', fontWeight: active ? 600 : 400, transition: 'all 0.12s',
  };
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        flexShrink: 0,
        position: 'relative',
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 'none',
        background: checked ? 'var(--accent)' : 'var(--btn-border)',
        cursor: 'pointer',
        transition: 'background 0.18s',
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 3,
        left: checked ? 19 : 3,
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#fff',
        transition: 'left 0.18s',
        display: 'block',
      }} />
    </button>
  );
}

// ── Setting row ───────────────────────────────────────────────────────────────

function Row({ label, description, control }: { label: string; description?: string; control: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0' }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>{label}</div>
        {description && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{description}</div>
        )}
      </div>
      {control}
    </div>
  );
}

// ── Category ids ──────────────────────────────────────────────────────────────
// One id per former Section divider — this is a re-layout of the existing
// groupings behind a sidebar + search, not a re-sort of which setting lives
// where.

type CategoryId = 'appearance' | 'language' | 'workspace' | 'presentation' | 'updates' | 'about';

// ── Main modal ────────────────────────────────────────────────────────────────

type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; pct: number | null }
  | { phase: 'done'; version: string }
  | 'error'          // check failed — server unreachable
  | 'install-error'; // downloaded, but verify/install failed

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

  type AboutItem =
    | { kind: 'link'; label: string; description: string; url: string }
    | { kind: 'submenu'; label: string; description: string };

  const ABOUT_ITEMS: AboutItem[] = [
    { kind: 'link', label: t('settings.aboutLinkGithub'),    description: t('settings.aboutLinkGithubDescription'),    url: 'https://github.com/KovaMD/Kova' },
    { kind: 'link', label: t('settings.aboutLinkIssues'),    description: t('settings.aboutLinkIssuesDescription'),    url: 'https://github.com/KovaMD/Kova/issues' },
    { kind: 'link', label: t('settings.aboutLinkWiki'),      description: t('settings.aboutLinkWikiDescription'),      url: 'https://wiki.kova.md/' },
    { kind: 'link', label: t('settings.aboutLinkSupport'),   description: t('settings.aboutLinkSupportDescription'),   url: 'https://opencollective.com/kovamd' },
    { kind: 'link', label: t('settings.aboutLinkCommunity'), description: t('settings.aboutLinkCommunityDescription'), url: 'https://matrix.to/#/#kova-md:matrix.org' },
    { kind: 'submenu', label: t('settings.showLicenses'),    description: t('settings.aboutLicensesDescription') },
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

  const [updateState, setUpdateState] = useState<UpdateState>(
    availableUpdate ? { phase: 'available', version: availableUpdate } : 'idle',
  );
  const pendingUpdate = useRef<AvailableUpdate | null>(null);
  const [selfUpdateSupported, setSelfUpdateSupported] = useState(true);
  useEffect(() => {
    canSelfUpdate().then((supported) => {
      setSelfUpdateSupported(supported);
    }).catch(() => {});
  }, []);

  const [aboutView, setAboutView] = useState<'main' | 'licenses'>('main');

  const [customWordList, setCustomWordList] = useState<string[]>(() => getCustomWords());
  const [showCustomWords, setShowCustomWords] = useState(false);

  const availableFonts = useMemo(() =>
    EDITOR_FONT_OPTIONS.filter(opt => opt.bundled || opt.value === 'system' || isFontAvailable(opt.family)),
    [],
  );

  // If the saved font is no longer available, reset to the bundled default
  useEffect(() => {
    if (!availableFonts.some(f => f.value === settings.editorFont)) {
      onChange({ ...settings, editorFont: 'ibm-plex-mono' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRemoveCustomWord(word: string) {
    removeCustomWord(word);
    setCustomWordList(getCustomWords());
  }

  async function runCheck() {
    setUpdateState('checking');
    try {
      const update = await fetchUpdate();
      if (update) {
        pendingUpdate.current = update;
        setUpdateState({ phase: 'available', version: update.version });
        onUpdateChecked(update.version);
      } else {
        pendingUpdate.current = null;
        setUpdateState('up-to-date');
        onUpdateChecked(null);
      }
    } catch (err) {
      console.error('[updater] check failed:', err);
      setUpdateState('error');
    }
  }

  async function runInstall() {
    let update = pendingUpdate.current;
    if (!update) {
      // Modal was opened from the startup notification — re-fetch to get the install handle
      setUpdateState('checking');
      try {
        update = await fetchUpdate();
        if (!update) { setUpdateState('up-to-date'); return; }
        pendingUpdate.current = update;
      } catch (err) {
        console.error('[updater] re-fetch failed:', err);
        setUpdateState('error');
        return;
      }
    }
    const { version } = update;
    setUpdateState({ phase: 'downloading', version, pct: null });
    try {
      let total: number | null = null;
      await update.install((downloaded, contentLength) => {
        if (total === null && contentLength) total = contentLength;
        setUpdateState({ phase: 'downloading', version, pct: total ? Math.round((downloaded / total) * 100) : null });
      });
      setUpdateState({ phase: 'done', version });
    } catch (err) {
      console.error('[updater] install failed:', err);
      setUpdateState('install-error');
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      width={700}
      ariaLabel={t('modals.settingsTitle')}
      cardStyle={{ padding: 0, display: 'flex', flexDirection: 'column', height: 'min(620px, 85vh)', overflow: 'hidden' }}
    >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{t('modals.settingsTitle')}</h2>
          <ModalCloseButton onClick={onClose} />
        </div>

        <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0 }}>

          {/* Category rail */}
          <nav style={{ width: 172, flexShrink: 0, borderRight: '1px solid var(--border)', padding: '12px 8px', overflowY: 'auto' }}>
            <div style={{ marginBottom: 10 }}>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('settings.searchPlaceholder')}
                style={{
                  width: '100%', padding: '6px 10px', fontSize: 12, borderRadius: 4,
                  border: '1px solid var(--border-alt)', background: 'var(--bg-input)',
                  color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
            {CATEGORIES.map((cat) => {
              const active = !searching && activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => { setActiveCategory(cat.id); setQuery(''); setAboutView('main'); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', fontFamily: 'inherit',
                    padding: '7px 9px', marginBottom: 1, borderRadius: 4, fontSize: 12.5,
                    border: 'none', borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                    background: active ? 'var(--accent-bg)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </nav>

          {/* Category content */}
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '14px 20px 20px' }}>
            {!searching && (
              <div style={{
                fontSize: 10, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase',
                letterSpacing: '0.1em', marginBottom: 10,
              }}>
                {CATEGORIES.find((c) => c.id === activeCategory)?.label}
              </div>
            )}

        {/* Appearance */}

        {inView('appearance', `${t('settings.appTheme')} ${t('settings.themeAuto')} ${t('settings.themeDark')} ${t('settings.themeLight')}`) && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.appTheme')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([
                { value: 'auto',  label: t('settings.themeAuto')  },
                { value: 'dark',  label: t('settings.themeDark')  },
                { value: 'light', label: t('settings.themeLight') },
              ] as const).map(({ value, label }) => (
                <button key={value} type="button" onClick={() => set('uiTheme', value)}
                  style={groupBtnStyle(settings.uiTheme === value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {settings.uiTheme === 'auto' && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
                {t('settings.themeAutoDescription')}
              </div>
            )}
          </div>
        )}

        {inView('appearance', t('settings.displayLanguage')) && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.displayLanguage')}</div>
            <div style={{ position: 'relative' }}>
              <select
                value={settings.locale}
                onChange={(e) => set('locale', e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 28px 6px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: '1px solid var(--border-alt)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  outline: 'none',
                }}
              >
                {UI_LOCALE_OPTIONS.map(({ code, label }) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
              <svg viewBox="0 0 10 6" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)' }}>
                <path d="M0 0l5 6 5-6z" fill="currentColor" />
              </svg>
            </div>
          </div>
        )}

        {inView('appearance', t('settings.interfaceScale')) && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.interfaceScale')}</div>
            <div style={{ position: 'relative' }}>
              <select
                value={Math.round(settings.uiScale * 100)}
                onChange={(e) => set('uiScale', Number(e.target.value) / 100)}
                style={{
                  width: '100%',
                  padding: '6px 28px 6px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: '1px solid var(--border-alt)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  outline: 'none',
                }}
              >
                {[70, 80, 90, 100, 110, 120, 130, 140, 150].map(pct => (
                  <option key={pct} value={pct}>{pct}%</option>
                ))}
              </select>
              <svg viewBox="0 0 10 6" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)' }}>
                <path d="M0 0l5 6 5-6z" fill="currentColor" />
              </svg>
            </div>
          </div>
        )}

        {inView('appearance', t('settings.editorFont')) && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.editorFont')}</div>
            <div style={{ position: 'relative' }}>
              <select
                value={settings.editorFont}
                onChange={(e) => set('editorFont', e.target.value as AppSettings['editorFont'])}
                style={{
                  width: '100%',
                  padding: '6px 28px 6px 10px',
                  fontSize: 12,
                  fontFamily: availableFonts.find(o => o.value === settings.editorFont)?.family ?? 'monospace',
                  borderRadius: 4,
                  border: '1px solid var(--border-alt)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  outline: 'none',
                }}
              >
                {availableFonts.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <svg
                viewBox="0 0 10 6"
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)',
                }}
              >
                <path d="M0 0l5 6 5-6z" fill="currentColor" />
              </svg>
            </div>
          </div>
        )}

        {inView('appearance', `${t('settings.showFrontmatter')} ${t('settings.showFrontmatterDescription')}`) && (
          <Row
            label={t('settings.showFrontmatter')}
            description={t('settings.showFrontmatterDescription')}
            control={<Toggle checked={settings.showFrontmatter} onChange={(v) => set('showFrontmatter', v)} />}
          />
        )}

        {inView('appearance', `${t('settings.wordWrap')} ${t('settings.wordWrapDescription')}`) && (
          <Row
            label={t('settings.wordWrap')}
            description={t('settings.wordWrapDescription')}
            control={<Toggle checked={settings.editorWordWrap} onChange={(v) => set('editorWordWrap', v)} />}
          />
        )}

        {inView('appearance', `${t('settings.contentWidth')} ${t('settings.contentWidthDescription')}`) && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{t('settings.contentWidth')}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
              {t('settings.contentWidthDescription')}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([
                { value: 'fixed', label: t('settings.contentWidthFixed') },
                { value: 'full',  label: t('settings.contentWidthFull')  },
              ] as { value: AppSettings['editorContentWidth']; label: string }[]).map(({ value, label }) => (
                <button key={value} type="button" onClick={() => set('editorContentWidth', value)}
                  style={groupBtnStyle(settings.editorContentWidth === value)}
                >{label}</button>
              ))}
            </div>
          </div>
        )}

        {inView('appearance', `${t('settings.defaultTheme')} ${t('settings.defaultThemeDescription')}`) && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{t('settings.defaultTheme')}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {t('settings.defaultThemeDescription')}
            </div>
            <div style={{ position: 'relative' }}>
              <select
                value={settings.defaultThemeId}
                onChange={(e) => set('defaultThemeId', e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 28px 6px 10px',
                  fontSize: 12,
                  borderRadius: 4,
                  border: '1px solid var(--border-alt)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  outline: 'none',
                }}
              >
                {allThemes.map(({ id, name }) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
              <svg
                viewBox="0 0 10 6"
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)',
                }}
              >
                <path d="M0 0l5 6 5-6z" fill="currentColor" />
              </svg>
            </div>
          </div>
        )}

        {/* Language & Spelling */}

        {inView('language', `${t('settings.checkSpelling')} ${t('settings.checkSpellingDescription')}`) && (
          <Row
            label={t('settings.checkSpelling')}
            description={t('settings.checkSpellingDescription')}
            control={<Toggle checked={settings.spellCheckEnabled} onChange={(v) => set('spellCheckEnabled', v)} />}
          />
        )}

        {inView('language', `${t('settings.dictionaryLanguage')} ${t('settings.learnedWords', { count: getCustomWordCount() })}`) && settings.spellCheckEnabled && (
          <>
            <div style={{ paddingBottom: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-label)', marginBottom: 8 }}>{t('settings.dictionaryLanguage')}</div>
              <div style={{ position: 'relative' }}>
                <select
                  value={settings.spellCheckLanguage}
                  onChange={(e) => set('spellCheckLanguage', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 28px 6px 10px',
                    fontSize: 12,
                    borderRadius: 4,
                    border: '1px solid var(--border-alt)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    outline: 'none',
                  }}
                >
                  {LANGUAGE_OPTIONS.map(({ code, label }) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
                <svg
                  viewBox="0 0 10 6"
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    width: 10, height: 6, pointerEvents: 'none', color: 'var(--text-dim)',
                  }}
                >
                  <path d="M0 0l5 6 5-6z" fill="currentColor" />
                </svg>
              </div>
            </div>

            <div style={{ paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: customWordList.length > 0 && showCustomWords ? 8 : 0 }}>
                <div style={{ fontSize: 11, color: 'var(--text-label)' }}>
                  {t('settings.learnedWords', { count: getCustomWordCount() })}
                </div>
                {customWordList.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowCustomWords(!showCustomWords)}
                    style={{
                      padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                      border: '1px solid var(--border-alt)', background: 'var(--bg-input)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {showCustomWords ? t('common.hide') : t('settings.learnedWordsManage')}
                  </button>
                )}
                {customWordList.length === 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('settings.learnedWordsNone')}</span>
                )}
              </div>

              {showCustomWords && customWordList.length > 0 && (
                <div style={{
                  marginTop: 8,
                  maxHeight: 160,
                  overflowY: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  background: 'var(--bg-app)',
                }}>
                  {customWordList.map((word) => (
                    <div key={word} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '5px 10px', borderBottom: '1px solid var(--border)',
                    }}>
                      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{word}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomWord(word)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px',
                          color: 'var(--text-dim)', fontSize: 14, lineHeight: 1,
                        }}
                        title={t('settings.removeFromDictionary')}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Workspace */}

        {inView('workspace', `${t('settings.autosave')} ${t('settings.autosaveDescription')}`) && (
          <Row
            label={t('settings.autosave')}
            description={t('settings.autosaveDescription')}
            control={<Toggle checked={settings.autosave} onChange={(v) => set('autosave', v)} />}
          />
        )}

        {inView('workspace', t('settings.saveEvery')) && settings.autosave && (
          <div style={{ paddingBottom: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--text-label)', marginBottom: 8 }}>{t('settings.saveEvery')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {INTERVAL_OPTIONS.map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set('autosaveIntervalSeconds', value)}
                  style={groupBtnStyle(settings.autosaveIntervalSeconds === value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {inView('workspace', `${t('settings.confirmBeforeClosing')} ${t('settings.confirmBeforeClosingDescription')}`) && (
          <Row
            label={t('settings.confirmBeforeClosing')}
            description={t('settings.confirmBeforeClosingDescription')}
            control={<Toggle checked={settings.confirmOnClose} onChange={(v) => set('confirmOnClose', v)} />}
          />
        )}

        {inView('workspace', `${t('settings.onStartup')} ${t('settings.onStartupDescription')}`) && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{t('settings.onStartup')}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
              {t('settings.onStartupDescription')}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([
                { value: 'blank',      label: t('settings.startupBlank') },
                { value: 'reopenLast', label: t('settings.startupReopenLast') },
              ] as { value: StartupBehavior; label: string }[]).map(({ value, label }) => (
                <button key={value} type="button" onClick={() => set('startupBehavior', value)}
                  style={groupBtnStyle(settings.startupBehavior === value)}
                >{label}</button>
              ))}
            </div>
          </div>
        )}

        {inView('workspace', `${t('settings.pdfPageSize')} ${t('settings.pdfPageSizeDescription')}`) && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{t('settings.pdfPageSize')}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
              {t('settings.pdfPageSizeDescription')}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([
                { value: 'a4',     label: t('settings.pageSizeA4')     },
                { value: 'letter', label: t('settings.pageSizeLetter') },
                { value: 'slide',  label: t('settings.pageSizeSlide')  },
              ] as { value: AppSettings['pdfPageSize']; label: string }[]).map(({ value, label }) => (
                <button key={value} type="button" onClick={() => set('pdfPageSize', value)}
                  style={groupBtnStyle(settings.pdfPageSize === value)}
                >{label}</button>
              ))}
            </div>
          </div>
        )}

        {/* Presentation */}

        {inView('presentation', `${t('settings.displayMode')} ${t('settings.displayModeDescription')}`) && (
          <div style={{ padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>{t('settings.displayMode')}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
              {t('settings.displayModeDescription')}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([
                { value: 'auto',   label: t('settings.displayModeAuto')   },
                { value: 'single', label: t('settings.displayModeSingle') },
                { value: 'dual',   label: t('settings.displayModeDual')   },
                { value: 'mirror', label: t('settings.displayModeMirror') },
              ] as { value: PresentationMode; label: string }[]).map(({ value, label }) => (
                <button key={value} type="button" onClick={() => set('presentationMode', value)}
                  style={groupBtnStyle(settings.presentationMode === value)}
                >{label}</button>
              ))}
            </div>
          </div>
        )}

        {inView('presentation', t('settings.laserPointerColour')) && (
          <Row
            label={t('settings.laserPointerColour')}
            control={
              <div style={{ display: 'flex', gap: 8 }}>
                {LASER_COLOR_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    title={label}
                    onClick={() => set('laserColor', value as LaserColor)}
                    style={{
                      width: 22, height: 22, borderRadius: '50%', padding: 0,
                      background: value,
                      border: settings.laserColor === value
                        ? '2px solid var(--accent)'
                        : '2px solid transparent',
                      outline: settings.laserColor === value ? '1px solid var(--accent)' : '1px solid var(--border)',
                      outlineOffset: 2,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  />
                ))}
              </div>
            }
          />
        )}

        {inView('presentation', `${t('settings.windowedPresenterView')} ${t('settings.windowedPresenterViewDescription')} ${t('settings.alwaysOnTop')} ${t('settings.alwaysOnTopDescription')} ${t('settings.showNextSlidePreview')} ${t('settings.showElapsedTimer')} ${t('settings.notesFontSize')}`) && (settings.presentationMode === 'dual' || settings.presentationMode === 'auto') && (
          <>
            <Row
              label={t('settings.windowedPresenterView')}
              description={t('settings.windowedPresenterViewDescription')}
              control={<Toggle checked={settings.presenterWindowed} onChange={(v) => set('presenterWindowed', v)} />}
            />
            {settings.presenterWindowed && (
              <Row
                label={t('settings.alwaysOnTop')}
                description={t('settings.alwaysOnTopDescription')}
                control={<Toggle checked={settings.presenterAlwaysOnTop} onChange={(v) => set('presenterAlwaysOnTop', v)} />}
              />
            )}
            <Row
              label={t('settings.showNextSlidePreview')}
              description={t('settings.showNextSlidePreviewDescription')}
              control={<Toggle checked={settings.presenterShowNextSlide} onChange={(v) => set('presenterShowNextSlide', v)} />}
            />
            <Row
              label={t('settings.showElapsedTimer')}
              description={t('settings.showElapsedTimerDescription')}
              control={<Toggle checked={settings.presenterShowTimer} onChange={(v) => set('presenterShowTimer', v)} />}
            />
            <div style={{ padding: '6px 0 10px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>{t('settings.notesFontSize')}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {([
                  { value: 'sm', label: t('settings.fontSizeSmall')  },
                  { value: 'md', label: t('settings.fontSizeMedium') },
                  { value: 'lg', label: t('settings.fontSizeLarge')  },
                ] as { value: NotesFontSize; label: string }[]).map(({ value, label }) => (
                  <button key={value} type="button" onClick={() => set('presenterNotesFontSize', value)}
                    style={groupBtnStyle(settings.presenterNotesFontSize === value)}
                  >{label}</button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Updates */}

        {inView('updates', `${t('settings.checkForUpdates')} ${t('settings.checkForUpdatesDescription')}`) && (
          <>
            {selfUpdateSupported ? (
              <Row
                label={t('settings.checkForUpdates')}
                description={t('settings.checkForUpdatesDescription')}
                control={<Toggle checked={settings.checkForUpdates} onChange={(v) => set('checkForUpdates', v)} />}
              />
            ) : (
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, padding: '10px 0' }}>
                {t('settings.updatesManagedByDistro')}
              </div>
            )}

            {selfUpdateSupported && <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 4 }}>
              {(updateState === 'idle' || updateState === 'up-to-date' || updateState === 'error' || updateState === 'install-error') && (
                <button
                  type="button"
                  onClick={runCheck}
                  style={{
                    padding: '5px 14px',
                    fontSize: 11,
                    borderRadius: 4,
                    border: '1px solid var(--border-alt)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {t('settings.checkNow')}
                </button>
              )}

              {updateState === 'checking' && (
                <button
                  type="button"
                  disabled
                  style={{
                    padding: '5px 14px',
                    fontSize: 11,
                    borderRadius: 4,
                    border: '1px solid var(--border-alt)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-dim)',
                    cursor: 'default',
                  }}
                >
                  {t('settings.checking')}
                </button>
              )}

              {updateState === 'up-to-date' && (
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('settings.upToDate', { version: APP_VERSION })}</span>
              )}

              {updateState === 'error' && (
                <span style={{ fontSize: 11, color: '#c0392b' }}>{t('settings.updateCheckError')}</span>
              )}

              {updateState === 'install-error' && (
                <span style={{ fontSize: 11, color: '#c0392b' }}>{t('settings.updateInstallError')}</span>
              )}

              {typeof updateState === 'object' && updateState.phase === 'available' && (
                <>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('settings.updateAvailable', { version: updateState.version })}</span>
                  <button
                    type="button"
                    onClick={runInstall}
                    style={{
                      padding: '5px 14px',
                      fontSize: 11,
                      borderRadius: 4,
                      border: '1px solid var(--accent)',
                      background: 'var(--accent-bg)',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {t('settings.updateNow')}
                  </button>
                </>
              )}

              {typeof updateState === 'object' && updateState.phase === 'downloading' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                    {t('settings.downloading', { version: updateState.version, pct: updateState.pct !== null ? ` — ${updateState.pct}%` : '…' })}
                  </span>
                  {updateState.pct !== null && (
                    <div style={{ width: 80, height: 3, background: 'var(--border)', borderRadius: 2 }}>
                      <div style={{
                        width: `${updateState.pct}%`,
                        height: '100%',
                        background: 'var(--accent)',
                        borderRadius: 2,
                        transition: 'width 0.15s',
                      }} />
                    </div>
                  )}
                </div>
              )}

              {typeof updateState === 'object' && updateState.phase === 'done' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--accent)' }}>
                    {t('settings.updateInstalled', { version: updateState.version })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (isDirty && !window.confirm(t('settings.restartConfirm'))) return;
                      restartApp();
                    }}
                    style={{
                      padding: '3px 10px',
                      fontSize: 11,
                      borderRadius: 4,
                      border: '1px solid var(--accent)',
                      background: 'transparent',
                      color: 'var(--accent)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {t('settings.restartNow')}
                  </button>
                </div>
              )}
            </div>}
          </>
        )}

        {/* About */}

        {inView('about', `Kova ${t('settings.aboutLicense')} ${ABOUT_ITEMS.map(l => `${l.label} ${l.description}`).join(' ')}`) && (
          !searching && aboutView === 'licenses' ? (
            <>
              <button
                type="button"
                onClick={() => setAboutView('main')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, marginBottom: 14,
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'inherit',
                }}
              >
                <svg width="7" height="10" viewBox="0 0 7 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 1 1.5 5 6 9" />
                </svg>
                {t('common.back')}
              </button>

              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
                {t('settings.showLicenses')}
              </div>

              <div style={{
                border: '1px solid var(--border)',
                borderRadius: 4,
                overflow: 'hidden',
              }}>
                {THIRD_PARTY_LICENSES.map((entry, i) => (
                  <div
                    key={entry.name}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'baseline',
                      gap: '6px 12px',
                      padding: '7px 10px',
                      background: i % 2 === 0 ? 'var(--bg-app)' : 'transparent',
                      borderBottom: i < THIRD_PARTY_LICENSES.length - 1 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{entry.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 8 }}>{entry.copyright}</span>
                    </div>
                    <span style={{
                      fontSize: 10,
                      color: 'var(--text-secondary)',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-alt)',
                      borderRadius: 3,
                      padding: '1px 6px',
                      whiteSpace: 'nowrap',
                    }}>
                      {entry.license}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Kova</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
                    {t('settings.aboutLicense')}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  v{APP_VERSION}
                </div>
              </div>

              <div style={{
                marginTop: 16,
                border: '1px solid var(--border)',
                borderRadius: 4,
                overflow: 'hidden',
              }}>
                {ABOUT_ITEMS.map((item, i) => (
                  <button
                    key={item.kind === 'link' ? item.url : 'licenses'}
                    type="button"
                    onClick={() => item.kind === 'link' ? openUrl(item.url).catch(() => {}) : setAboutView('licenses')}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      width: '100%', textAlign: 'left', fontFamily: 'inherit',
                      padding: '10px 12px',
                      background: i % 2 === 0 ? 'var(--bg-app)' : 'transparent',
                      border: 'none',
                      borderBottom: i < ABOUT_ITEMS.length - 1 ? '1px solid var(--border)' : 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{item.description}</div>
                    </div>
                    {item.kind === 'link' ? (
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2"
                        strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)', flexShrink: 0 }}
                      >
                        <path d="M4 2h5v5" />
                        <path d="M8.8 2.2 2 9" />
                      </svg>
                    ) : (
                      <svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.3"
                        strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-dim)', flexShrink: 0 }}
                      >
                        <path d="M1 1 5 5 1 9" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </>
          )
        )}

          </div>
        </div>
    </ModalShell>
  );
}
