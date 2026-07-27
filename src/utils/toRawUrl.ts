// Convert standard web URLs for common Git hosts to their raw content equivalents.
export function toRawUrl(input: string): string {
  try {
    const u = new URL(input);

    // GitHub: /user/repo/blob/branch/path → raw.githubusercontent.com/user/repo/branch/path
    if (u.hostname === 'github.com') {
      const m = u.pathname.match(/^(\/[^/]+\/[^/]+)\/blob(\/.+)$/);
      if (m) return `https://raw.githubusercontent.com${m[1]}${m[2]}`;
    }

    // GitLab: /user/repo/-/blob/branch/path → /user/repo/-/raw/branch/path
    if (u.hostname === 'gitlab.com' || u.hostname.endsWith('.gitlab.com')) {
      const m = u.pathname.match(/^(.+\/-\/)blob(\/.+)$/);
      if (m) return `${u.origin}${m[1]}raw${m[2]}`;
    }

    // Bitbucket: /user/repo/src/branch/path → /user/repo/raw/branch/path
    if (u.hostname === 'bitbucket.org') {
      const m = u.pathname.match(/^(\/[^/]+\/[^/]+)\/src(\/.+)$/);
      if (m) return `${u.origin}${m[1]}/raw${m[2]}`;
    }
  } catch {
    // Not a valid URL — pass through and let the backend error naturally.
  }
  return input;
}
