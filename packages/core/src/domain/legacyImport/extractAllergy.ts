/**
 * 世帯構成員の付帯情報(parseFamilyInfoのinfo)からアレルギーの記述を取り出す。
 *
 * GAS版は取込時にアレルギー列を常に空で書き込み(CsvImport.js updateDatabaseFromLinesV2)、
 * 「家族DB_New」シートのアレルギー列を手で埋めた場合だけ顧客詳細に表示していた(空なら「なし」)。
 * 本アプリではシートの手入力が無くなるため、RESERVAの自由記述に明示的に書かれたものだけを
 * 保守的に拾う。infoは加工せずそのまま残す(拾い損ね・誤判定があっても情報が失われないように)。
 *
 * - 「アレルギーなし」「アレルギー:無し」等 → 'なし'
 * - 「アレルギー:卵」「アレルギー：乳・小麦」 → ラベルの後ろの値
 * - 「卵アレルギー」等、上記以外で「アレルギー」を含む語 → その語をそのまま
 * いずれも無ければnull。
 */
const NONE_PATTERN = /^アレルギー[:：]?(?:なし|無し|無|ナシ|特になし)$/;
const LABELED_PATTERN = /^アレルギー[:：](.+)$/;

export function extractAllergy(info: string): string | null {
  const tokens = info.split(/\s+/).filter((t) => t.includes('アレルギー'));
  if (tokens.length === 0) return null;

  const values = tokens.map((token) => {
    if (NONE_PATTERN.test(token)) return 'なし';
    const labeled = LABELED_PATTERN.exec(token);
    return labeled?.[1] ? labeled[1] : token;
  });
  const specific = values.filter((v) => v !== 'なし' && v !== 'アレルギー');
  if (specific.length > 0) return Array.from(new Set(specific)).join(' ');
  return values.includes('なし') ? 'なし' : null;
}
