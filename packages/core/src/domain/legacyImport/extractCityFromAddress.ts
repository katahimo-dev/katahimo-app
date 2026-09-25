/**
 * 住所文字列から市区町村(地区)を抽出する。移植元: gas-childcare-visit-app/Main.js の
 * fetchDataFromSheet()内、`city`を組み立てている部分(都道府県の除去→「〇〇市〇〇区」優先→
 * 「〇〇市/区/町/村」にフォールバック、の2段階マッチ)と同じロジック。
 *
 * GAS版はこの抽出結果をそのまま「訪問先一覧」の地区絞り込みセレクトに使っており、実務上
 * 十分な精度で機能している。RESERVA CSV取込では以前「信頼できるパーサーが無い」として
 * 未実装のままにしていたが、GAS版が実際に使っているこのパーサーをそのまま移植すれば十分
 * (完全な住所パーサーである必要はなく、地区絞り込みの粒度で合っていればよい)。
 */
export function extractCityFromAddress(address: string): string {
  if (!address) return '';

  let rest = address;
  const prefectureMatch = address.match(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)\s*/);
  if (prefectureMatch) {
    rest = address.slice(prefectureMatch[0].length);
  }

  const cityWardMatch = rest.match(/^([^0-9\s]+市[^0-9\s]+区)/);
  if (cityWardMatch?.[1]) return cityWardMatch[1];

  const municipalityMatch = rest.match(/^([^0-9\s]+[市区町村])/);
  if (municipalityMatch?.[1]) return municipalityMatch[1];

  return '';
}
