import type { AccidentReportContent } from './types';

/**
 * 事故報告の各項目を、活動記録タイムライン表示用の1本のテキストに結合する。
 *
 * GAS版 Main.js の getCustomerReports が事故報告シートの行から internalText を組み立てる
 * ロジックと同一(項目の並び順・見出し・空行の入れ方も含めて完全に一致させる。移植元:
 * `if (row[6]) parts.push('【発生時間】'+row[6])` 以下7行)。空文字/未入力の項目は
 * そもそも見出しごと出力しない。
 */
export function buildAccidentHistoryInternalText(content: AccidentReportContent): string {
  const parts: string[] = [];
  if (content.occurrenceTime) parts.push(`【発生時間】${content.occurrenceTime}`);
  if (content.location) parts.push(`【場所】${content.location}`);
  if (content.situation) parts.push(`【状況】\n${content.situation}`);
  if (content.accidentContent) parts.push(`【事故内容】\n${content.accidentContent}`);
  if (content.immediateResponse) parts.push(`【応急処置】\n${content.immediateResponse}`);
  if (content.diagnosisTreatment) parts.push(`【受診・治療】\n${content.diagnosisTreatment}`);
  if (content.prevention) parts.push(`【再発防止策】\n${content.prevention}`);
  return parts.join('\n\n');
}
