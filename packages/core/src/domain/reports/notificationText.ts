import type { AccidentReportContent, DailyReportContent } from './types';

/** ★☆表記。GAS版Main.js saveReportのstar()と同一。 */
function star(n: number | null): string {
  const v = Number(n) || 0;
  return '★'.repeat(v) + '☆'.repeat(5 - v);
}

/**
 * 日報保存時のGoogle Chat通知本文。GAS版Main.js saveReportの lwText 組み立てと完全に同一
 * (項目の並び順・見出し・空行も含む)。
 */
export function buildDailyReportNotificationText(params: {
  staffName: string;
  customerName: string;
  content: Pick<DailyReportContent, 'startTime' | 'endTime' | 'internalText'>;
  riskRating: number | null;
  esRating: number | null;
}): string {
  let ratingsInfo = '';
  if (params.riskRating || params.esRating) {
    ratingsInfo = '\n【評価指標】';
    if (params.riskRating) ratingsInfo += `\nPSI: ${star(params.riskRating)} (${params.riskRating})`;
    if (params.esRating) ratingsInfo += `\n満足度: ${star(params.esRating)} (${params.esRating})`;
  }
  const visitTime =
    params.content.startTime && params.content.endTime
      ? `${params.content.startTime}〜${params.content.endTime}`
      : params.content.startTime || '';

  return `【日報提出】
担当: ${params.staffName}
顧客名: ${params.customerName}
訪問時間: ${visitTime}${ratingsInfo}

${params.content.internalText}`;
}

/**
 * 事故報告/ヒヤリハット保存時のGoogle Chat通知本文。GAS版Main.js saveAccidentReportの
 * lwText 組み立てと完全に同一。
 */
export function buildAccidentReportNotificationText(params: {
  staffName: string;
  customerName: string;
  reportType: string;
  content: AccidentReportContent;
}): string {
  const typeLabel = params.reportType || '事故報告';
  const c = params.content;
  return `【${typeLabel}】
担当: ${params.staffName}
顧客名: ${params.customerName}
対象: ${c.targetName}
生年月日: ${c.targetDob}
発生日時: ${c.occurrenceTime}
発生場所: ${c.location}
事故内容: ${c.accidentContent}
発生状況: ${c.situation}
発生時の対応: ${c.immediateResponse}
保護者への対応: ${c.parentCorrespondence}
診断名および処置状況: ${c.diagnosisTreatment}
今後の対応: ${c.prevention}`;
}

export interface ReceiptNotificationImage {
  /** 重複としてブロックされた画像はここに含めない(GAS版のduplicateIndices除外と同じ)。 */
  amount: string;
  storeName: string;
}

/**
 * 領収書登録時のGoogle Chat通知本文。GAS版Main.js uploadReceiptsOnlyの lwMsg 組み立てと
 * 完全に同一(重複除外後の画像だけを対象にする点も含む)。
 */
export function buildReceiptNotificationText(params: {
  staffName: string;
  customerName: string | null;
  /** 'yyyy/MM/dd HH:mm:ss'。formatJstDateTime()の出力をそのまま渡す想定。 */
  receiptTimestamp: string;
  /** 重複でブロックされたものを除いた、登録成功分の画像だけ。 */
  registeredImages: ReceiptNotificationImage[];
  handoffText: string;
}): string {
  const customerStr = params.customerName ? `顧客名: ${params.customerName}\n` : '';
  const dateStr = params.receiptTimestamp ? params.receiptTimestamp.split(' ')[0] : '';

  let receiptDetails = '';
  for (const img of params.registeredImages) {
    const amountStr = img.amount ? `${img.amount}円` : '未入力';
    const storeStr = img.storeName ? img.storeName : '未入力';
    receiptDetails += `\n名称: ${storeStr} / 金額: ${amountStr}`;
  }

  const trimmedHandoff = params.handoffText.trim();
  const handoffStr = trimmedHandoff ? `\n\n申し送り:\n${trimmedHandoff}` : '';

  return `【領収書登録】\n担当: ${params.staffName || '不明'}\n${customerStr}日付: ${dateStr}${receiptDetails}${handoffStr}`;
}
