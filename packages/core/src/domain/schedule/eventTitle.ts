/**
 * 予定タイトルのタグ解析。
 *
 * 移植元: RouteSearch.js getCalendarEvents。RESERVAが作る予約は「[予約確定]山田 花子」、
 * スタッフが手で入れる予定は「[新規]」「[イベント]」「[事務]」をタイトルに付ける運用。
 * タグが複数付いている場合は 予約確定 > 新規 > イベント > 事務 の順で1つに決まり、
 * どのタグも無い予定(私用等)は予定一覧・ルート計算の対象外になる。
 */
export type EventTag = 'confirmed' | 'newCustomer' | 'specialEvent' | 'officeWork';

const TAG_LABELS: ReadonlyArray<readonly [EventTag, string]> = [
  ['confirmed', '[予約確定]'],
  ['newCustomer', '[新規]'],
  ['specialEvent', '[イベント]'],
  ['officeWork', '[事務]'],
];

export interface ParsedEventTitle {
  /** 優先順位で選ばれたタグ。タグが無ければnull。 */
  tag: EventTag | null;
  /** 全タグ(各1回目の出現)を取り除いて前後の空白を削った名前。顧客名・予定名として使う。 */
  name: string;
}

export function parseEventTitle(title: string): ParsedEventTitle {
  const tag = TAG_LABELS.find(([, label]) => title.includes(label))?.[0] ?? null;
  // GAS版は String.prototype.replace(文字列) を使っており、各タグの最初の1回だけを取り除く。
  const name = TAG_LABELS.reduce((rest, [, label]) => rest.replace(label, ''), title).trim();
  return { tag, name };
}
