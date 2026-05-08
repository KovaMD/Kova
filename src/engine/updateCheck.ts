import { APP_VERSION } from '../version';

export interface UpdateResult {
  latestTag: string;
  hasUpdate: boolean;
}

export async function checkForUpdate(): Promise<UpdateResult> {
  // /tags lists all tags regardless of release/draft status (unlike /releases/latest
  // which only returns published non-draft releases).
  const r = await fetch('https://api.github.com/repos/KovaMD/Kova/tags?per_page=1', {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (!r.ok) throw new Error(`GitHub API returned ${r.status}`);
  const tags = await r.json() as Array<{ name: string }>;
  if (!tags.length) return { latestTag: APP_VERSION, hasUpdate: false };
  const latestTag = tags[0].name;
  return { latestTag, hasUpdate: semverGt(latestTag, APP_VERSION) };
}

function semverGt(a: string, b: string): boolean {
  const nums = (s: string) => s.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [a0, a1, a2] = nums(a);
  const [b0, b1, b2] = nums(b);
  return a0 !== b0 ? a0 > b0 : a1 !== b1 ? a1 > b1 : a2 > b2;
}
