/**
 * 送信元IP単位のレート制限(ログインの失敗・パスワード再設定・外部連携の認証の失敗・公開デモの AI の回数)の対象を
 * IP アドレスから決める。IPv6 は利用者1人(1回線)に /64 がまとめて割り当てられるのが普通で、アドレスそのものを対象に
 * すると /64 の中のアドレスを替えながら上限を回避できるため、/64 の範囲を1つの対象にする。
 * - IPv4: そのまま
 * - IPv4 射影の IPv6(`::ffff:192.0.2.1` / `::ffff:c000:201`): 中の IPv4(IPv4 と同じ対象にする)
 * - それ以外の IPv6: 先頭 64 ビットの範囲を RFC 5952 の正規の書き方で(`2001:db8:1:2::/64`)。省略形・大文字・
 *   ゾーンID(`fe80::1%eth0`)・角かっこ(`[2001:db8::1]`)の違いは同じ対象になる
 * - 読めない値: そのまま(数え方を変えないだけで、拒否も緩めもしない)
 * 操作ログ(app_logs)・セッションの記録には、ここで変える前のアドレスをそのまま残す。
 */
export function rateLimitIpSubject(ip: string): string {
  if (parseIpv4(ip)) return ip;
  const groups = parseIpv6(ip);
  if (!groups) return ip;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
  }
  return `${formatIpv6([...groups.slice(0, 4), 0, 0, 0, 0])}/64`;
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/i;

/** ドット区切りの IPv4 の4つの数(読めなければ null)。 */
function parseIpv4(value: string): number[] | null {
  const m = IPV4_PATTERN.exec(value);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

function parseGroups(part: string): number[] | null {
  if (part === '') return [];
  const groups: number[] = [];
  for (const g of part.split(':')) {
    if (!IPV6_GROUP_PATTERN.test(g)) return null;
    groups.push(Number.parseInt(g, 16));
  }
  return groups;
}

/** IPv6 の8つの16ビットの値(読めなければ null)。 */
function parseIpv6(raw: string): number[] | null {
  let value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  if (!value.includes(':')) return null;

  // 末尾の IPv4 の書き方(`::ffff:192.0.2.1`)は2つの16ビットに直す
  let tail: number[] = [];
  const lastColon = value.lastIndexOf(':');
  const last = value.slice(lastColon + 1);
  if (last.includes('.')) {
    const octets = parseIpv4(last);
    if (!octets) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    tail = [(a << 8) | b, (c << 8) | d];
    value = value.slice(0, lastColon + 1);
    // `::ffff:` の末尾の ':' は IPv4 の区切りなので外す(`::` の一部なら残す)
    if (!value.endsWith('::')) value = value.slice(0, -1);
  }

  const halves = value.split('::');
  if (halves.length > 2) return null;
  const head = parseGroups(halves[0] ?? '');
  if (!head) return null;
  if (halves.length === 1) {
    const groups = [...head, ...tail];
    return groups.length === 8 ? groups : null;
  }
  const rest = parseGroups(halves[1] ?? '');
  if (!rest) return null;
  const known = head.length + rest.length + tail.length;
  // `::` は1つ以上の0の並びを表す
  if (known > 7) return null;
  return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...tail];
}

/** RFC 5952 の書き方(小文字・先頭の0を省く・最も長い2つ以上の0の並び(同じ長さなら最初)を `::`)。 */
function formatIpv6(groups: number[]): string {
  let bestStart = -1;
  let bestLength = 1;
  for (let i = 0; i < groups.length; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < groups.length && groups[j] === 0) j++;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}
