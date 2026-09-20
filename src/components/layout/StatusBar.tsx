import { APP_VERSION } from '../../version';
import { useT } from '../../i18n';

const WPM = 110;

interface Props {
  currentSlide: number;
  totalSlides: number;
  layoutName?: string;
  layoutOverridden?: boolean;
  wordCount: number;
  isDirty: boolean;
  filePath: string | null;
  externalImageCount: number;
  aspectRatioLabel: string;
  onAspectRatioCycle: () => void;
  availableUpdate?: string | null;
  onVersionClick?: () => void;
  locale: string;
}

export function StatusBar({ currentSlide, totalSlides, layoutName, layoutOverridden, wordCount, isDirty, filePath, externalImageCount, aspectRatioLabel, onAspectRatioCycle, availableUpdate, onVersionClick, locale }: Props) {
  const t = useT();
  const minutes = Math.ceil(wordCount / WPM);
  // Mirrors handleAspectRatioCycle's cycle order in App.tsx (4:3 -> 16:10 ->
  // 16:9 -> 4:3); anything else (including a custom aspect_ratio set directly
  // in frontmatter) goes to 4:3 next, same as there.
  const nextAr = aspectRatioLabel === '4:3' ? '16:10' : aspectRatioLabel === '16:10' ? '16:9' : '4:3';
  const formattedWordCount = wordCount.toLocaleString(locale === 'auto' ? undefined : locale);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        height: 24,
        background: 'var(--status-bg)',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
        fontSize: 11,
        color: 'var(--text-muted)',
        userSelect: 'none',
      }}
    >
      <Cell>
        {totalSlides > 0 ? t('layout.slideCountStatus', { current: currentSlide, total: totalSlides }) : t('layout.noSlides')}
      </Cell>
      {layoutName && (
        <>
          <Divider />
          <Cell title={layoutOverridden ? t('layout.layoutTooltipOverridden', { name: layoutName }) : t('layout.layoutTooltipAuto')}>
            {layoutOverridden ? t('layout.layoutStatusOverridden', { name: layoutName }) : t('layout.layoutStatus', { name: layoutName })}
          </Cell>
        </>
      )}
      <Divider />
      <Cell>{t('layout.estimatedMinutes', { count: minutes })}</Cell>
      <Divider />
      <Cell>{t('layout.wordCount', { count: wordCount, formatted: formattedWordCount })}</Cell>
      <Divider />
      <button
        type="button"
        onClick={onAspectRatioCycle}
        title={t('layout.aspectRatioTooltip', { current: aspectRatioLabel, next: nextAr })}
        style={{
          padding: '0 10px',
          height: '100%',
          background: 'none',
          border: 'none',
          fontSize: 11,
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontFamily: 'inherit',
          letterSpacing: '0.02em',
        }}
      >
        {aspectRatioLabel}
      </button>
      {externalImageCount > 0 && (
        <>
          <Divider />
          <Cell
            title={t('layout.externalImageWarning', { count: externalImageCount })}
            style={{ color: 'var(--dirty-color)', cursor: 'default' }}
          >
            {t('layout.externalImageBadge', { count: externalImageCount })}
          </Cell>
        </>
      )}
      <div style={{ flex: 1 }} />
      {(filePath || isDirty) && (
        <>
          <Cell style={{ color: isDirty ? 'var(--dirty-color)' : 'var(--text-dim)' }}>
            {isDirty ? (filePath ? t('layout.unsaved') : t('layout.newUnsaved')) : t('layout.saved')}
          </Cell>
          <Divider />
        </>
      )}
      {availableUpdate && onVersionClick ? (
        <button
          type="button"
          onClick={onVersionClick}
          title={t('layout.updateAvailableTooltip', { version: availableUpdate })}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 10px',
            height: '100%',
            background: 'none',
            border: 'none',
            fontSize: 11,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            letterSpacing: '0.02em',
          }}
        >
          {t('layout.kovaVersion', { version: APP_VERSION })}
          <svg
            width="11" height="11" viewBox="0 0 24 24"
            fill="none" stroke="#D94F00" strokeWidth="2.4"
            strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <line x1="12" y1="19" x2="12" y2="5"/>
            <polyline points="5 12 12 5 19 12"/>
          </svg>
        </button>
      ) : (
        <Cell>{t('layout.kovaVersion', { version: APP_VERSION })}</Cell>
      )}
    </div>
  );
}

function Cell({ children, style, title }: { children: React.ReactNode; style?: React.CSSProperties; title?: string }) {
  return (
    <div title={title} style={{ padding: '0 10px', ...style }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 12, background: 'var(--border)' }} />;
}
