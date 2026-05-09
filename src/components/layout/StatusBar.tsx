const WPM = 110;

interface Props {
  currentSlide: number;
  totalSlides: number;
  wordCount: number;
  isDirty: boolean;
  filePath: string | null;
  externalImageCount: number;
}

export function StatusBar({ currentSlide, totalSlides, wordCount, isDirty, filePath, externalImageCount }: Props) {
  const minutes = Math.ceil(wordCount / WPM);
  const timeStr = minutes < 2 ? `${minutes} min` : `${minutes} mins`;

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
        {totalSlides > 0 ? `Slide ${currentSlide} of ${totalSlides}` : 'No slides'}
      </Cell>
      <Divider />
      <Cell>Est. {timeStr}</Cell>
      <Divider />
      <Cell>{wordCount.toLocaleString()} words</Cell>
      {externalImageCount > 0 && (
        <>
          <Divider />
          <Cell
            title={`${externalImageCount} image${externalImageCount > 1 ? 's are' : ' is'} outside this file's folder — ${externalImageCount > 1 ? 'they' : 'it'} won't appear if the file is moved`}
            style={{ color: 'var(--dirty-color)', cursor: 'default' }}
          >
            ⚠ {externalImageCount} external image{externalImageCount > 1 ? 's' : ''}
          </Cell>
        </>
      )}
      <div style={{ flex: 1 }} />
      {(filePath || isDirty) && (
        <>
          <Cell style={{ color: isDirty ? 'var(--dirty-color)' : 'var(--text-dim)' }}>
            {isDirty ? (filePath ? 'Unsaved' : 'New — unsaved') : 'Saved'}
          </Cell>
          <Divider />
        </>
      )}
      <Cell>kova v0.1</Cell>
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
