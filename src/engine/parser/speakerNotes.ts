// Split on the first ??? that appears outside a code fence.
export function extractSpeakerNotes(slideContent: string): { content: string; notes: string } {
  const lines = slideContent.split('\n');
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('```')) inFence = !inFence;
    if (!inFence && t === '???') {
      return {
        content: lines.slice(0, i).join('\n').trim(),
        notes:   lines.slice(i + 1).join('\n').trim(),
      };
    }
  }
  return { content: slideContent.trim(), notes: '' };
}
