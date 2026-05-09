import yaml from 'js-yaml';
import type { Frontmatter } from '../types';

export function extractFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  try {
    const parsed = yaml.load(match[1], { schema: yaml.CORE_SCHEMA });
    const frontmatter = (parsed && typeof parsed === 'object' ? parsed : {}) as Frontmatter;
    return { frontmatter, body: match[2] };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

/**
 * Merges patch into the document's YAML frontmatter and returns the updated
 * content string. Keys with undefined/null values are removed. If the document
 * has no frontmatter block, one is created.
 */
export function patchFrontmatter(content: string, patch: Record<string, unknown>): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  let existing: Record<string, unknown> = {};
  let body = content;

  if (match) {
    try { existing = (yaml.load(match[1]) as Record<string, unknown>) ?? {}; } catch { /* keep empty */ }
    body = match[2];
  }

  const merged: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) {
      delete merged[k];
    } else {
      merged[k] = v;
    }
  }

  const newYaml = yaml.dump(merged, { lineWidth: -1, quotingType: '"' }).trimEnd();
  return `---\n${newYaml}\n---\n${body}`;
}
