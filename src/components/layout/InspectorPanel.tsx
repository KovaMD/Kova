import { useState, useCallback } from 'react';
import type { Theme } from '../../engine/theme';
import type { Frontmatter } from '../../engine/types';
import { ThemePicker } from '../inspector/ThemePicker';
import { ColorControls } from '../inspector/ColorControls';
import { FontControls } from '../inspector/FontControls';
import { LogoControls } from '../inspector/LogoControls';
import { FormatControls } from '../inspector/FormatControls';
import type { FormatCmd } from './EditorPanel';

interface Props {
  filePath: string | null;
  slideCount: number;
  frontmatter: Frontmatter;
  theme: Theme;
  allThemes: Theme[];
  onThemeSelect: (id: string) => void;
  onThemeChange: (patch: Partial<Theme>) => void;
  onFormat: (cmd: FormatCmd) => void;
  onExport?: () => Promise<void>;
}

type Section = 'format' | 'theme' | 'colours' | 'fonts' | 'branding';

export function InspectorPanel({
  filePath, slideCount, frontmatter,
  theme, allThemes, onThemeSelect, onThemeChange, onFormat, onExport,
}: Props) {
  const [open, setOpen] = useState<Section | null>('format');
  const [exporting, setExporting] = useState(false);
  const toggle = (s: Section) => setOpen((prev) => (prev === s ? null : s));

  const handleExport = useCallback(async () => {
    if (!onExport) return;
    setExporting(true);
    try { await onExport(); } finally { setExporting(false); }
  }, [onExport]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e' }}>
      <div className="panel-header">Inspector</div>
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Document info */}
        <InfoSection>
          <Row label="File"   value={filePath ? shortPath(filePath) : '—'} />
          <Row label="Slides" value={slideCount > 0 ? String(slideCount) : '—'} />
          {frontmatter.title  && <Row label="Title"  value={frontmatter.title} />}
          {frontmatter.author && <Row label="Author" value={frontmatter.author} />}
          {frontmatter.date   && <Row label="Date"   value={String(frontmatter.date)} />}
        </InfoSection>

        <Divider />

        {/* Text formatting */}
        <Accordion label="Format" open={open === 'format'} onToggle={() => toggle('format')}>
          <FormatControls onFormat={onFormat} />
        </Accordion>

        <Divider />

        {/* Theme picker */}
        <Accordion label="Theme" open={open === 'theme'} onToggle={() => toggle('theme')}>
          <ThemePicker themes={allThemes} activeId={theme.id} onSelect={onThemeSelect} />
        </Accordion>

        <Accordion label="Colours" open={open === 'colours'} onToggle={() => toggle('colours')}>
          <ColorControls
            colors={theme.colors}
            onChange={(key, val) => onThemeChange({ colors: { ...theme.colors, [key]: val } })}
          />
        </Accordion>

        <Accordion label="Fonts" open={open === 'fonts'} onToggle={() => toggle('fonts')}>
          <FontControls
            fonts={theme.fonts}
            onChange={(key, val) => onThemeChange({ fonts: { ...theme.fonts, [key]: val } })}
          />
        </Accordion>

        <Accordion label="Branding" open={open === 'branding'} onToggle={() => toggle('branding')}>
          <LogoControls
            logo={theme.logo}
            logoPosition={theme.logo_position}
            header={theme.header}
            footer={theme.footer}
            onLogoChange={(path) => onThemeChange({ logo: path })}
            onLogoPositionChange={(pos) => onThemeChange({ logo_position: pos })}
            onHeaderChange={(header) => onThemeChange({ header })}
            onFooterChange={(footer) => onThemeChange({ footer })}
          />
        </Accordion>

        <Divider />

        {/* Export */}
        <div style={{ padding: '10px 12px' }}>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={exporting || slideCount === 0 || !onExport}
            onClick={handleExport}
            title={slideCount === 0 ? 'Open a file to export' : 'Export as PowerPoint (.pptx)'}
          >
            {exporting ? 'Exporting…' : 'Export PPTX'}
          </button>
        </div>

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
    <div style={{ borderTop: '1px solid #2a2a2a' }}>
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
          color: '#888',
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          cursor: 'pointer',
        }}
      >
        {label}
        <span style={{ color: '#555', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 12px 12px' }}>{children}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, gap: 8 }}>
      <span style={{ fontSize: 11, color: '#777', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, color: '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }} title={value}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: '#2a2a2a', margin: '2px 0' }} />;
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}
