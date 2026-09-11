import yaml from 'js-yaml';
import type { Frontmatter } from '../types';

// Anchored to the start of the document; the closing fence is the first `---`
// on its own line. Kept in sync with diagnostics.ts's FRONTMATTER_RE.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/**
 * A leading `---`…`---` block only counts as frontmatter when its YAML body
 * parses to a mapping. A block that reads as empty (blank, or comments only) or
 * as a bare scalar is almost always a stray opening `---` left behind after an
 * edit, with the first `---` slide separator beneath it being mistaken for the
 * closing fence — treating it as frontmatter would silently swallow slide one.
 * In that case callers must behave as if there is no frontmatter at all.
 */
function parseBlock(content: string): { data: Record<string, unknown>; length: number } | null {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = yaml.load(match[1], { schema: yaml.CORE_SCHEMA, json: true });
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return { data: parsed as Record<string, unknown>, length: match[0].length };
}

export function extractFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const block = parseBlock(content);
  if (!block) return { frontmatter: {}, body: content };
  return { frontmatter: block.data as Frontmatter, body: content.slice(block.length) };
}

/** Character length of the leading frontmatter block, or 0 when there is none. */
export function frontmatterBlockLength(content: string): number {
  return parseBlock(content)?.length ?? 0;
}

/**
 * Merges patch into the document's YAML frontmatter and returns the updated
 * content string. Keys with undefined/null values are removed. If the merge
 * leaves no keys the frontmatter block is dropped entirely (rather than
 * emitting an empty `--- {} ---`). If the document has no frontmatter block and
 * the patch adds keys, one is created.
 */
export function patchFrontmatter(content: string, patch: Record<string, unknown>): string {
  const block = parseBlock(content);
  const body = block ? content.slice(block.length) : content;

  const merged: Record<string, unknown> = { ...(block?.data ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) {
      delete merged[k];
    } else {
      merged[k] = v;
    }
  }

  if (Object.keys(merged).length === 0) return body;

  const newYaml = yaml.dump(merged, { lineWidth: -1, quotingType: '"' }).trimEnd();
  return `---\n${newYaml}\n---\n${body}`;
}
