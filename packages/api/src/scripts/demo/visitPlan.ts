/**
 * 「誰をいつ訪問するか」を日付から決定論的に導出する(公開デモの `pnpm demo:reset` 専用)。
 *
 * デモにはGoogleカレンダーが無く、予定を過去分もDBに貯めると日付をまたぐたびに作り直しが必要になる。
 * 日付・スタッフ名を入力にした純関数として組み立てておけば、日報・出勤簿のシードが同じ関数を通ることで
 * 両者が食い違わない(同じ日の同じスタッフなら常に同じ訪問予定になる)。
 */

/** 1日あたりの訪問枠(出勤簿テンプレートの1日3訪問に合わせる。時刻は列記号を使わない、デモ専用の値)。 */
export const DEMO_VISIT_SLOTS: readonly [
  { start: string; end: string },
  { start: string; end: string },
  { start: string; end: string },
] = [
  { start: '10:00', end: '11:30' },
  { start: '13:00', end: '14:30' },
  { start: '15:30', end: '17:00' },
];

export interface PlannedVisit {
  /** DEMO_FIGURES 上の index。呼び出し側が実際の顧客IDへ解決する。 */
  figureIndex: number;
  start: string;
  end: string;
}

/** 文字列から32bitのハッシュを作る(FNV-1a)。日付ごとに安定した並びを得るための種。 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** DateをJST基準の 'YYYY-MM-DD' にする。業務日は全てJSTで扱う。 */
export function toJstDateIso(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/**
 * その日の訪問件数。平日3件・土曜2件・日曜1件(勤怠に週のリズムが出るようにする。0件にすると
 * 日曜に見た人の予定・出勤簿が空になり、第一印象が悪くなるので最低1件は入れる)。
 */
export function visitCountForDate(dateIso: string): number {
  // 正午UTCで解釈する(深夜0時だとタイムゾーンのずれで前日の曜日を拾う)。
  const day = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  if (day === 0) return 1;
  if (day === 6) return 2;
  return DEMO_VISIT_SLOTS.length;
}

/**
 * 指定日・指定スタッフの訪問予定を返す(同じ日に同じ世帯を二重に入れない)。
 * @param candidates 選ぶ候補の世帯(DEMO_FIGURES の index。スタッフの担当の地域。staffAreas.ts)
 */
export function planVisitsForDate(
  dateIso: string,
  staffName: string,
  candidates: readonly number[],
): PlannedVisit[] {
  const visitCount = visitCountForDate(dateIso);
  if (visitCount === 0 || candidates.length === 0) return [];

  // 日付・スタッフ名を種に候補を並べ替え(Fisher–Yates)、先頭から訪問の件数だけ取る(組み合わせ・順番とも偏らないように)
  const shuffled = [...new Set(candidates)];
  let state = hashString(`${dateIso}|${staffName}`);
  for (let i = shuffled.length - 1; i > 0; i--) {
    state = hashString(`${state}`);
    const j = state % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j] as number, shuffled[i] as number];
  }
  const chosen = shuffled.slice(0, visitCount);

  return chosen.map((figureIndex, i) => {
    const slot = DEMO_VISIT_SLOTS[i];
    if (!slot) throw new Error('訪問枠の数を超えて予定を組もうとしました');
    return { figureIndex, start: slot.start, end: slot.end };
  });
}

/** シード時に「過去◯日ぶんの履歴」を作るための業務日の一覧(古い順。today 当日は含まない)。 */
export function recentBusinessDates(today: Date, days: number): string[] {
  const dates: string[] = [];
  for (let offset = days; offset >= 1; offset--) {
    dates.push(toJstDateIso(new Date(today.getTime() - offset * 24 * 60 * 60 * 1000)));
  }
  return dates;
}
