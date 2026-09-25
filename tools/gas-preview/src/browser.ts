import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright-core';

/**
 * Chromium を起動する。この環境には Playwright 用の Chromium が PLAYWRIGHT_BROWSERS_PATH
 * (既定 /opt/pw-browsers)に入っている。playwright-core の版はその Chromium(revision 1194)に
 * 合わせて 1.56 系に固定している(`playwright install` はしない)。版が合わない場合に備えて、
 * 見つからなければ入っている chromium-* の実行ファイルを直接指定する。
 *
 * ブラウザからは外部に出ない(Google Fonts は fontCache.ts がNode側で取得して返す)。
 */
export async function launchChromium(): Promise<Browser> {
  // 外部への通信は route で全部受けるため、プロキシは使わせない
  const args = ['--no-proxy-server'];
  try {
    return await chromium.launch({ args });
  } catch (e) {
    const executablePath = findInstalledChromium();
    if (!executablePath) throw e;
    console.warn(`[gas-preview] 既定のChromiumが見つからないため ${executablePath} を使います`);
    return chromium.launch({ args, executablePath });
  }
}

function findInstalledChromium(): string | null {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse();
  for (const dir of dirs) {
    const candidate = join(root, dir, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
