import {invoke} from '@tauri-apps/api/core';
import {useEffect, useMemo, useRef, useState} from 'react';

import {imageMime} from '../engine/export/imageMime';
import {videoMime} from '../engine/export/videoMime';
import {detectLayout} from '../engine/layout/autoLayout';
import {localPathFromMediaSrc, resolveHtmlSrcs, resolveImageSrc, VIDEO_EXT_RE,} from '../engine/resolveMediaPath';
import type {ListItem, Slide} from '../engine/types';

// Rewrite image srcs to data: URLs (or asset:// while loading) so Tauri's
// WebView can load them reliably on all platforms, including Windows/WebView2,
// and pre-compute TOC entries / re-run layout detection for toc slides.
//
// resolvedSlidesCacheRef keys by the *input* Slide object's identity:
// parseDocument (markdownToSlides.ts) already reuses the previous Slide
// object for any slide whose raw text is unchanged, so caching this step
// the same way means an edit to one slide no longer produces a brand-new
// object for *every* slide in the deck — which in turn is what lets
// ThumbnailPanel's React.memo actually skip re-rendering slides the user
// isn't currently editing. WeakMap so entries for slides that no longer
// exist (deleted, or shifted out of cache by an insertion) are
// garbage-collected rather than accumulating for the life of the session.
export function useResolvedSlides(rawSlides: Slide[], docDir: string): Slide[] {
  // Load all local images/videos as base64 data URLs via IPC. convertFileSrc /
  // the asset:// protocol is unreliable on Windows/WebView2, so we bypass it
  // entirely for local media files — the same approach already used for logos.
  const [localImageUrls, setLocalImageUrls] =
      useState<Map<string, string>>(() => new Map());
  // parseDocument always returns a new *array* reference for rawSlides (even
  // when individual Slide objects are reused), so this effect re-runs on
  // every keystroke, not just when media actually changes. Track the last
  // resolved contents here so a re-run that resolves to identical data can
  // skip setLocalImageUrls — otherwise a fresh Map reference on every
  // keystroke fails the `cacheHolder.localImageUrls !== localImageUrls` check
  // below and discards the entire per-slide WeakMap cache for nothing.
  const resolvedRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const paths = new Set<string>();

    function collectHtml(html: string) {
      for (const match of html.matchAll(/src="([^"]*)"/g)) {
        const p = localPathFromMediaSrc(match[1], docDir);
        if (p) paths.add(p);
      }
    }
    function collectItem(item: ListItem) {
      collectHtml(item.html);
      item.children.forEach(collectItem);
    }
    for (const slide of rawSlides) {
      if (slide.backgroundImage) {
        const p = localPathFromMediaSrc(slide.backgroundImage.src, docDir);
        if (p) paths.add(p);
      }
      for (const el of slide.elements) {
        if (el.type === 'image' || el.type === 'video') {
          const p = localPathFromMediaSrc(el.src, docDir);
          if (p) paths.add(p);
        } else if (el.type === 'paragraph') {
          collectHtml(el.html);
        } else if (el.type === 'list') {
          el.items.forEach(collectItem);
        }
      }
    }

    const setIfChanged = (next: Map<string, string>) => {
      const prev = resolvedRef.current;
      const unchanged = next.size === prev.size &&
          Array.from(next).every(([k, v]) => prev.get(k) === v);
      if (unchanged) return;
      resolvedRef.current = next;
      setLocalImageUrls(next);
    };

    if (paths.size === 0) {
      setIfChanged(new Map());
      return;
    }

    let cancelled = false;
    Promise
        .all(Array.from(paths).map(async (path) => {
          try {
            const b64 = await invoke<string>('read_file_b64', {path});
            const mime =
                VIDEO_EXT_RE.test(path) ? videoMime(path) : imageMime(path);
            return [path, `data:${mime};base64,${b64}`] as [string, string];
          } catch (e) {
            console.error('[Kova] read_file_b64 failed for', path, e);
            return null;
          }
        }))
        .then((entries) => {
          if (!cancelled)
            setIfChanged(new Map(
                entries.filter((e): e is[string, string] => e !== null)));
        });

    return () => {
      cancelled = true;
    };
  }, [rawSlides, docDir]);

  const resolvedSlidesCacheRef = useRef<{
    docDir: string; localImageUrls: Map<string, string>;
    cache: WeakMap<Slide, Slide>
  }>({
    docDir: '',
    localImageUrls: new Map(),
    cache: new WeakMap(),
  });

  const slides = useMemo<Slide[]>(() => {
    function resolveItem(item: ListItem): ListItem {
      return {
        ...item,
        html: resolveHtmlSrcs(item.html, docDir, localImageUrls),
        children: item.children.map(resolveItem)
      };
    }

    let cacheHolder = resolvedSlidesCacheRef.current;
    if (cacheHolder.docDir !== docDir ||
        cacheHolder.localImageUrls !== localImageUrls) {
      // docDir or image cache changed — every resolved src would be wrong,
      // start fresh.
      cacheHolder = {docDir, localImageUrls, cache: new WeakMap()};
      resolvedSlidesCacheRef.current = cacheHolder;
    }
    const {cache} = cacheHolder;

    // Pre-compute TOC entries from all non-hidden, titled slides. Derived from
    // rawSlides (titles are identical in raw vs resolved) so it's always
    // current. TOC slides are excluded from the WeakMap cache below because
    // their resolved content depends on other slides' titles, not just their
    // own raw text. Exclude the first non-hidden H1 slide (the cover/title
    // slide) from the TOC. Subsequent H1 hero slides within the deck are
    // included.
    const coverIndex =
        rawSlides.find((s) => !s.hidden && s.titleLevel === 1)?.index ?? -1;
    const tocEntries =
        rawSlides.filter((s) => !s.hidden && s.title && s.index !== coverIndex)
            .map((s) => ({title: s.title, index: s.index}));

    return rawSlides.map((slide) => {
      const hasToc = slide.elements.some((e) => e.type === 'toc');
      if (!hasToc) {
        const cached = cache.get(slide);
        if (cached) return cached;
      }
      const resolvedElements = slide.elements.map((el) => {
        if (el.type === 'image' || el.type === 'video')
          return {...el, src: resolveImageSrc(el.src, docDir, localImageUrls)};
        if (el.type === 'paragraph')
          return {
            ...el,
            html: resolveHtmlSrcs(el.html, docDir, localImageUrls)
          };
        if (el.type === 'list')
          return {...el, items: el.items.map(resolveItem)};
        if (el.type === 'toc')
          return {
            ...el,
            entries: tocEntries.filter((e) => e.index !== slide.index)
          };
        return el;
      });
      // detectLayout ran at parse time against a placeholder toc with zero
      // entries (the real slide titles aren't known until this pass), so a
      // long toc never tripped the two-column overflow guard. Re-run it now
      // that entries are populated, unless the user pinned an explicit layout.
      const layout = hasToc && !slide.layoutOverride ?
          detectLayout(resolvedElements, slide.titleLevel, !!slide.title) :
          slide.layout;
      const resolved: Slide = {
        ...slide,
        elements: resolvedElements,
        layout,
        backgroundImage: slide.backgroundImage ? {
          ...slide.backgroundImage,
          src:
              resolveImageSrc(slide.backgroundImage.src, docDir, localImageUrls)
        } :
                                                 undefined,
      };
      if (!hasToc) cache.set(slide, resolved);
      return resolved;
    });
  }, [rawSlides, docDir, localImageUrls]);

  return slides;
}
