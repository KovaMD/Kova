import { describe, it, expect } from 'vitest';
import { extractSpeakerNotes } from '../parser/speakerNotes';

describe('extractSpeakerNotes', () => {
  it('splits on ??? returning content and notes', () => {
    const { content, notes } = extractSpeakerNotes('Slide body\n\n???\n\nMy notes');
    expect(content).toBe('Slide body');
    expect(notes).toBe('My notes');
  });

  it('returns empty notes when no ??? present', () => {
    const { content, notes } = extractSpeakerNotes('Just content\n- item');
    expect(content).toBe('Just content\n- item');
    expect(notes).toBe('');
  });

  it('ignores ??? inside a code fence', () => {
    const input = '```\n???\n```\n\n???\n\nReal notes';
    const { content, notes } = extractSpeakerNotes(input);
    expect(notes).toBe('Real notes');
    expect(content).toContain('???'); // the one inside the fence stays
  });

  it('trims surrounding whitespace from both parts', () => {
    const { content, notes } = extractSpeakerNotes('  Body  \n\n???\n\n  Notes  ');
    expect(content).toBe('Body');
    expect(notes).toBe('Notes');
  });

  it('handles multi-line notes', () => {
    const input = 'Body\n\n???\n\nLine one\nLine two\nLine three';
    const { notes } = extractSpeakerNotes(input);
    expect(notes).toContain('Line one');
    expect(notes).toContain('Line three');
  });

  it('treats ??? with surrounding text on same line as NOT a separator', () => {
    const { notes } = extractSpeakerNotes('Some ??? text\n\n???\n\nNotes');
    // Only the standalone ??? acts as separator
    expect(notes).toBe('Notes');
  });

  it('handles ??? as the very last line', () => {
    const { content, notes } = extractSpeakerNotes('Body\n\n???');
    expect(content).toBe('Body');
    expect(notes).toBe('');
  });

  it('handles empty input', () => {
    const { content, notes } = extractSpeakerNotes('');
    expect(content).toBe('');
    expect(notes).toBe('');
  });
});
