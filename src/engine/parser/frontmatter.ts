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
