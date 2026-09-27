/**
 * Google ドライブのファイルの URL からファイル ID を取り出す(GAS版の「領収書一覧」の写真の列は file.getUrl() の
 * 'https://drive.google.com/file/d/<ID>/view?usp=drivesdk')。'open?id=' / 'uc?id=' の形も読む。読めなければ null。
 */
const FILE_ID = '[A-Za-z0-9_-]{10,}';
const PATTERNS = [new RegExp(`/file/d/(${FILE_ID})`), new RegExp(`[?&]id=(${FILE_ID})`)];
const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com']);

export function driveFileIdOfLink(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !DRIVE_HOSTS.has(url.hostname)) return null;
  const target = `${url.pathname}${url.search}`;
  for (const pattern of PATTERNS) {
    const match = pattern.exec(target);
    if (match?.[1]) return match[1];
  }
  return null;
}
