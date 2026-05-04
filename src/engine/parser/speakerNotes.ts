export function extractSpeakerNotes(slideContent: string): { content: string; notes: string } {
  const parts = slideContent.split(/^\?\?\?$/m);
  return {
    content: (parts[0] ?? '').trim(),
    notes: (parts[1] ?? '').trim(),
  };
}
