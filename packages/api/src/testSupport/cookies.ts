import { SESSION_COOKIE_NAME } from '../session';

/** 応答の Set-Cookie から、名前の Cookie の `名前=値` を探す(本番の `__Host-` 接頭辞つきの名前も)。 */
function setCookiePair(res: Response, name: string): { pair: string; value: string } | null {
  for (const line of res.headers.getSetCookie()) {
    const [pair = ''] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const cookieName = pair.slice(0, idx);
    if (cookieName === name || cookieName === `__Host-${name}`) return { pair, value: pair.slice(idx + 1) };
  }
  return null;
}

/** 応答の Set-Cookie から名前の Cookie の値を読む(無ければ null。Set-Cookie の順には頼らない)。 */
export function setCookieValue(res: Response, name: string): string | null {
  return setCookiePair(res, name)?.value ?? null;
}

/** ログインの応答からセッションの Cookie を、要求の Cookie ヘッダーに入れる形(`名前=値`)で返す(無ければ空文字)。 */
export function sessionCookieOf(res: Response): string {
  return setCookiePair(res, SESSION_COOKIE_NAME)?.pair ?? '';
}
