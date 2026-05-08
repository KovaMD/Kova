import type { FormatCmd } from '../layout/EditorPanel';

interface Props {
  onFormat: (cmd: FormatCmd) => void;
}

function Btn({
  label, title, onClick, style,
}: { label: string; title: string; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        padding: '4px 0',
        fontSize: 11,
        borderRadius: 3,
        border: '1px solid #2e2e2e',
        background: '#2a2a2a',
        color: '#bbb',
        cursor: 'pointer',
        lineHeight: 1,
        ...style,
      }}
    >
      {label}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, marginTop: 8 }}>
      {children}
    </div>
  );
}

export function FormatControls({ onFormat }: Props) {
  const f = onFormat;

  return (
    <div>
      <Label>Headings</Label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }}>
        {([1, 2, 3, 4, 5, 6] as const).map((n) => (
          <Btn key={n} label={`H${n}`} title={`Heading ${n}`} onClick={() => f({ type: 'heading', level: n })}
            style={{ fontSize: n <= 2 ? 12 : n <= 4 ? 11 : 10, fontWeight: 700 }}
          />
        ))}
      </div>

      <Label>Inline</Label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 3 }}>
        <Btn label="B"  title="Bold (Ctrl+B)"        onClick={() => f({ type: 'bold' })}          style={{ fontWeight: 700 }} />
        <Btn label="I"  title="Italic (Ctrl+I)"      onClick={() => f({ type: 'italic' })}        style={{ fontStyle: 'italic' }} />
        <Btn label="U"  title="Underline"             onClick={() => f({ type: 'underline' })}     style={{ textDecoration: 'underline' }} />
        <Btn label="S"  title="Strikethrough"         onClick={() => f({ type: 'strikethrough' })} style={{ textDecoration: 'line-through' }} />
        <Btn label="`"  title="Inline code"           onClick={() => f({ type: 'code' })}          style={{ fontFamily: 'monospace' }} />
      </div>

      <Label>Block</Label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 3 }}>
        <Btn label="UL"   title="Bullet list"    onClick={() => f({ type: 'ul' })} />
        <Btn label="OL"   title="Numbered list"  onClick={() => f({ type: 'ol' })} />
        <Btn label="❝"    title="Blockquote"     onClick={() => f({ type: 'blockquote' })} />
        <Btn label="—"    title="Horizontal rule" onClick={() => f({ type: 'hr' })} />
      </div>

    </div>
  );
}
