/**
 * 日報/事故報告の暗号化対象(content)の中身。GAS版の「日報」「事故報告」シートの列のうち、
 * occurredAt・riskRating・esRating・reportType以外(=自由記述)をここにまとめる
 * (daily_reports/accident_reportsテーブルのcontentCiphertext参照)。
 */
export interface DailyReportContent {
  /** 'HH:mm'。未入力は空文字(GAS版のStartTime/EndTime列と同じ)。 */
  startTime: string;
  endTime: string;
  /** 保育日報のメモ(口語入力。AI生成前の元テキスト)。GAS版のInputText列。 */
  inputText: string;
  /** 社内向けレポート本文。GAS版のInternalReport列。 */
  internalText: string;
  /** 保護者向けレポート本文。GAS版のCustomerReport列。 */
  customerText: string;
}

export interface AccidentReportContent {
  /** 対象児(世帯構成員)の氏名。GAS版のTargetName列。 */
  targetName: string;
  /** 'yyyy/MM/dd'。GAS版のTargetDob列。 */
  targetDob: string;
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
  /** 元のメモ(口語入力)。GAS版のOriginalInput列。 */
  inputText: string;
}
