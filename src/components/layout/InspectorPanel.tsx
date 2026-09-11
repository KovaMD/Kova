import { useState, useEffect, useRef } from 'react';
import type { Theme, ThemeOverridePatch, ThemeOverrides } from '../../engine/theme';
import { defaultChartPalette } from '../../engine/theme';
import type { Frontmatter } from '../../engine/types';
import { ThemePicker } from '../inspector/ThemePicker';
import { ColorControls } from '../inspector/ColorControls';
import { FontControls } from '../inspector/FontControls';
import { LogoControls } from '../inspector/LogoControls';
import { FormatControls } from '../inspector/FormatControls';
import type { FormatCmd } from './EditorPanel';
import { useT } from '../../i18n';

interface Props {
  filePath: string | null;
  slideCount: number;
  frontmatter: Frontmatter;
  theme: Theme;
  themeOverrides: ThemeOverrides;
  allThemes: Theme[];
  onThemeSelect: (id: string) => void;
  onThemeChange: (patch: ThemeOverridePatch) => void | Promise<void>;
  onMetaChange: (field: 'title' | 'author' | 'date', value: string) => void;
  onFormat: (cmd: FormatCmd) => void;
  onOpenLibrary: () => void;
}

type Section = 'format' | 'theme' | 'colours' | 'fonts' | 'document';
const ALL_SECTIONS: Section[] = ['format', 'theme', 'colours', 'fonts', 'document'];

export function InspectorPanel({
  filePath, slideCount, frontmatter,
  theme, themeOverrides, allThemes, onThemeSelect, onThemeChange, onMetaChange, onFormat, onOpenLibrary,
}: Props) {
  const t = useT();
  const [open, setOpen] = useState<Set<Section>>(new Set(['format']));
  const [localTitle,  setLocalTitle]  = useState(frontmatter.title  ?? '');
  const [localAuthor, setLocalAuthor] = useState(frontmatter.author ?? '');
  const [localDate,   setLocalDate]   = useState(frontmatter.date   != null ? String(frontmatter.date) : '');
  const focusedFieldRef = useRef<'title' | 'author' | 'date' | null>(null);
  const colorOverrideKeys = new Set(Object.keys(themeOverrides.colors ?? {}));
  const fontOverrideKeys = new Set(Object.keys(themeOverrides.fonts ?? {}));

  // Guard against overwriting a field the user is actively editing.
  useEffect(() => { if (focusedFieldRef.current !== 'title')  setLocalTitle(frontmatter.title ?? ''); },  [frontmatter.title]);
  useEffect(() => { if (focusedFieldRef.current !== 'author') setLocalAuthor(frontmatter.author ?? ''); }, [frontmatter.author]);
  useEffect(() => { if (focusedFieldRef.current !== 'date')   setLocalDate(frontmatter.date != null ? String(frontmatter.date) : ''); }, [frontmatter.date]);

  const toggle = (s: Section) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  const allOpen = open.size === ALL_SECTIONS.length;
  const toggleAll = () =>
    setOpen(allOpen ? new Set() : new Set(ALL_SECTIONS));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel-alt)' }}>
      <div className="panel-header">
        {t('inspector.inspectorTitle')}
        <button
          onClick={toggleAll}
          title={allOpen ? t('inspector.collapseAllSections') : t('inspector.expandAllSections')}
          style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            color: 'var(--text-dim)', cursor: 'pointer', fontSize: 10, padding: '0 2px',
          }}
        >
          {allOpen ? '▲▲' : '▼▼'}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Document info */}
        <InfoSection>
          <Row label={t('inspector.fileLabel')}   value={filePath ? shortPath(filePath) : '—'} />
          <Row label={t('inspector.slidesLabel')} value={slideCount > 0 ? String(slideCount) : '—'} />
          <EditableRow
            label={t('inspector.titleLabel')}
            value={localTitle}
            placeholder={t('inspector.titlePlaceholder')}
            onChange={setLocalTitle}
            onFocus={() => { focusedFieldRef.current = 'title'; }}
            onBlur={() => { focusedFieldRef.current = null; onMetaChange('title', localTitle); }}
          />
          <EditableRow
            label={t('inspector.authorLabel')}
            value={localAuthor}
            placeholder={t('inspector.authorPlaceholder')}
            onChange={setLocalAuthor}
            onFocus={() => { focusedFieldRef.current = 'author'; }}
            onBlur={() => { focusedFieldRef.current = null; onMetaChange('author', localAuthor); }}
          />
          <EditableRow
            label={t('inspector.dateLabel')}
            value={localDate}
            placeholder={t('inspector.datePlaceholder')}
            onChange={setLocalDate}
            onFocus={() => { focusedFieldRef.current = 'date'; }}
            onBlur={() => { focusedFieldRef.current = null; onMetaChange('date', localDate); }}
          />
        </InfoSection>

        <Divider />

        {/* Text formatting */}
        <Accordion label={t('inspector.sectionFormat')} open={open.has('format')} onToggle={() => toggle('format')}>
          <FormatControls onFormat={onFormat} />
        </Accordion>

        <Divider />

        {/* Theme picker */}
        <Accordion label={t('inspector.sectionTheme')} open={open.has('theme')} onToggle={() => toggle('theme')}>
          <ThemePicker themes={allThemes} activeId={theme.id} onSelect={onThemeSelect} />
          <button
            type="button"
            onClick={onOpenLibrary}
            style={{
              width: '100%',
              marginTop: 8,
              padding: '5px 8px',
              fontSize: 11,
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            {t('inspector.moreThemesButton')}
          </button>
        </Accordion>

        <Accordion label={t('inspector.sectionColours')} open={open.has('colours')} onToggle={() => toggle('colours')}>
          <ColorControls
            colors={theme.colors}
            overriddenKeys={colorOverrideKeys}
            onChange={(key, val) => onThemeChange({ colors: { [key]: val } })}
            onChartColorChange={(index, val) => {
              const current = theme.colors.chart_colors ?? defaultChartPalette(theme.colors.accent, 8);
              const next = [...current];
              next[index] = val;
              onThemeChange({ colors: { chart_colors: next } });
            }}
            onChartPaletteReset={() => onThemeChange({ colors: { chart_colors: undefined } })}
          />
        </Accordion>

        <Accordion label={t('inspector.sectionFonts')} open={open.has('fonts')} onToggle={() => toggle('fonts')}>
          <FontControls
            fonts={theme.fonts}
            overriddenKeys={fontOverrideKeys}
            onChange={(key, val) => onThemeChange({ fonts: { [key]: val } })}
          />
        </Accordion>

        <Accordion label={t('inspector.sectionDocument')} open={open.has('document')} onToggle={() => toggle('document')}>
          <LogoControls
            logo={theme.logo}
            logoPosition={theme.logo_position}
            logoOpacity={theme.logo_opacity}
            header={theme.header}
            footer={theme.footer}
            toc={theme.toc}
            logoOverridden={'logo' in themeOverrides}
            headerOverridden={themeOverrides.header !== undefined}
            footerOverridden={themeOverrides.footer !== undefined}
            tocOverridden={themeOverrides.toc !== undefined}
            onLogoChange={(path) => onThemeChange({ logo: path ?? null })}
            onLogoPositionChange={(pos) => onThemeChange({ logo_position: pos })}
            onLogoOpacityChange={(opacity) => onThemeChange({ logo_opacity: opacity })}
            onHeaderChange={(header) => onThemeChange({ header })}
            onFooterChange={(footer) => onThemeChange({ footer })}
            onTocChange={(toc) => onThemeChange({ toc })}
          />
        </Accordion>

      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function InfoSection({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '10px 12px' }}>{children}</div>;
}

function Accordion({
  label, open, onToggle, children,
}: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'none',
          border: 'none',
          color: 'var(--text-label)',
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          cursor: 'pointer',
        }}
      >
        {label}
        <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 12px 12px' }}>{children}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-label)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }} title={value}>{value}</span>
    </div>
  );
}

function EditableRow({ label, value, placeholder, onChange, onFocus, onBlur }: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  onBlur: () => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-label)', flexShrink: 0 }}>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => { onFocus?.(); e.currentTarget.style.borderBottomColor = 'var(--accent, var(--border))'; }}
        onBlur={(e) => { e.currentTarget.style.borderBottomColor = 'transparent'; onBlur(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11,
          color: 'var(--text-primary)',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid transparent',
          outline: 'none',
          textAlign: 'right',
          padding: '1px 2px',
          borderRadius: 0,
          fontFamily: 'inherit',
        }}
      />
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />;
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}
