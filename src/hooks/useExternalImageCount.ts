import { useEffect, useState } from 'react';
import { countExternalImages } from '../engine/externalImages';

/**
 * countExternalImages for the open document, debounced: a full-document scan
 * on every keystroke adds up in a large deck, and the status-bar warning only
 * needs to settle a moment after the user stops typing.
 */
export function useExternalImageCount(content: string, filePath: string | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!filePath) { setCount(0); return; }
    const id = setTimeout(() => setCount(countExternalImages(content, filePath)), 400);
    return () => clearTimeout(id);
  }, [content, filePath]);
  return count;
}
