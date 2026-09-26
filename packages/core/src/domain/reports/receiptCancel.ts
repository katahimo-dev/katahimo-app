import type { StaffRole } from '@katahimo/shared';
import { addDays, lastDayOfMonth, yearMonthOf } from '../calendarDate';
import { isAdminRole } from '../staff/roles';

/**
 * 領収書の取消(論理削除)ができる期間。日付はどれもテナントのタイムゾーンの暦日 'YYYY-MM-DD'。
 *
 * 基準の日(receiptDate)は領収書日時の暦日(receipts.receipted_at。日報からの登録では訪問日+開始時刻、OCR で
 * 読めた領収書はその日時)。月の集計(今月のまとめ・出勤簿の Excel)も同じ日で月を分けるため、取消も同じ日で
 * 月の締めに合わせる。
 *
 * - 管理者: 今日と同じ月の領収書ならいつでも(他のスタッフの分も、月の最終日も。月末に集計するため)
 * - スタッフ本人・コーディネーター: 基準の日+2日まで、今日と同じ月で、今日が月の最終日でないとき
 *   (月末で締めるので月をまたいでは取消せない。最終日の深夜に消されると集計が合わなくなるため最終日も不可)
 *
 * どちらも、その月の出勤簿が締め済み(attendance_periods)なら取消せない(呼び出し側で確かめる)。
 */
export type ReceiptCancelRefusal = 'other_month' | 'deadline_passed' | 'month_end';

/** 取消せない理由(取消せるなら null)。 */
export function receiptCancelRefusal(input: {
  receiptDate: string;
  today: string;
  role: StaffRole;
}): ReceiptCancelRefusal | null {
  const { receiptDate, today } = input;
  if (yearMonthOf(receiptDate) !== yearMonthOf(today)) return 'other_month';
  if (isAdminRole(input.role)) return null;
  if (today === lastDayOfMonth(yearMonthOf(today))) return 'month_end';
  if (today > addDays(receiptDate, 2)) return 'deadline_passed';
  return null;
}

/** 取消せない理由の案内(画面に出す)。 */
export const RECEIPT_CANCEL_REFUSAL_MESSAGES: Record<ReceiptCancelRefusal | 'period_locked', string> = {
  other_month: '前の月の領収書は取消せません(月末で締めています)。',
  deadline_passed: '領収書の取消は、領収書の日付の2日後までです。',
  month_end: '月の最終日は領収書を取消せません(月末の集計のため)。管理者に連絡してください。',
  period_locked: 'この月の出勤簿は締め済みのため、領収書を取消せません。',
};
