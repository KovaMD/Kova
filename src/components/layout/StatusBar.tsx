const WPM = 110;

interface Props {
  currentSlide: number;
  totalSlides: number;
  wordCount: number;
  isDirty: boolean;
  filePath: string | null;
}

export function StatusBar({ currentSlide, totalSlides, wordCount, isDirty, filePath }: Props) {
  const minutes = Math.ceil(wordCount / WPM);
  const timeStr = minutes < 2 ? `${minutes} min` : `${minutes} mins`;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        height: 24,
        background: '#161616',
        borderTop: '1px solid #2a2a2a',
        flexShrink: 0,
        fontSize: 11,
        color: '#666',
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
      <div style={{ flex: 1 }} />
      {(filePath || isDirty) && (
        <>
          <Cell style={{ color: isDirty ? '#c07a30' : '#555' }}>
            {isDirty ? (filePath ? 'Unsaved' : 'New — unsaved') : 'Saved'}
          </Cell>
          <Divider />
        </>
      )}
      <Cell>kova v0.1</Cell>
    </div>
  );
}

function Cell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ padding: '0 10px', ...style }}>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 12, background: '#333' }} />;
}
