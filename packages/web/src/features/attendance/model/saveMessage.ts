/**
 * 保存したときのお知らせ。サーバーの文言(「修正しました。」「変更はありませんでした。」)をそのまま出し、
 * 無ければ変わった列の数で決める(GAS版 savePastScheduleValues_ の `res.message || '保存しました'`)。
 */
export function savedMessage(res: { message?: string; changedCount: number }): string {
  if (res.message) return res.message;
  return res.changedCount > 0 ? '保存しました' : '変更はありませんでした';
}
