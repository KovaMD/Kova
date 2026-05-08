import { APP_VERSION } from '../version';

export interface UpdateResult {
  latestTag: string;
  hasUpdate: boolean;
}

export async function checkForUpdate(): Promise<UpdateResult> {
  const r = await fetch('https://api.github.com/repos/KovaMD/Kova/releases/latest', {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (!r.ok) throw new Error(`GitHub API returned ${r.status}`);
  const { tag_name: latestTag } = await r.json() as { tag_name: string };
  return { latestTag, hasUpdate: semverGt(latestTag, APP_VERSION) };
}

function semverGt(a: string, b: string): boolean {
  const nums = (s: string) => s.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [a0, a1, a2] = nums(a);
  const [b0, b1, b2] = nums(b);
  return a0 !== b0 ? a0 > b0 : a1 !== b1 ? a1 > b1 : a2 > b2;
}
