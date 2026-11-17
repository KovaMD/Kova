import { describe, it, expect } from 'vitest';
import { extractYoutubeId, youtubeThumb } from '../youtube';

describe('extractYoutubeId', () => {
  it('reads the id from a watch?v= URL', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('reads v= when it is not the first query parameter', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('stops at following query parameters and fragments', () => {
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ#t=42')).toBe('dQw4w9WgXcQ');
  });

  it('reads the id from a youtu.be short link', () => {
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ#x')).toBe('dQw4w9WgXcQ');
  });

  it('reads the id from an embed URL', () => {
    expect(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeId('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1')).toBe('dQw4w9WgXcQ');
  });

  it('prefers a v= parameter over the path when both are present', () => {
    expect(extractYoutubeId('https://youtu.be/pathId?v=queryId')).toBe('queryId');
  });

  it('does not recognise /shorts/ URLs', () => {
    expect(extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBeNull();
  });

  it('matches a v= parameter on any host (no host check)', () => {
    expect(extractYoutubeId('https://example.com/page?v=123')).toBe('123');
  });

  it('returns null when nothing matches', () => {
    expect(extractYoutubeId('https://example.com')).toBeNull();
    expect(extractYoutubeId('https://www.youtube.com/')).toBeNull();
    expect(extractYoutubeId('')).toBeNull();
  });
});

describe('youtubeThumb', () => {
  it('builds the mqdefault thumbnail URL from the id', () => {
    expect(youtubeThumb('https://youtu.be/dQw4w9WgXcQ')).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  });

  it('returns null when no id is found', () => {
    expect(youtubeThumb('https://example.com')).toBeNull();
  });
});
