/**
 * outboxから取り出したミラージョブ1件を、実際にGoogleスプレッドシート/Driveへ反映するポート。
 *
 * MirrorPort(./mirror.ts)が「積む」側なのに対し、こちらは「送る」側。ペイロードは
 * ワーカー側のusecase(usecases/mirrorWorker.ts)がDBから最新値を読み直し・復号・
 * スタッフ/顧客名の解決まで済ませた後の、GAS側の列にそのまま書き込める形にしてある
 * (GAS側の分類・整形ロジックをこちらで再実装しないため)。
 *
 * 実装は@katahimo/integrationsに置く(GasBridgeMirrorSenderPort、gas-childcare-visit-appの
 * Bridge.jsへPOSTする)。GAS_BRIDGE_URL/SECRET未設定時はNoopMirrorSenderPort(何もしない)。
 */

export interface DailyReportMirrorPayload {
  /** GAS側「日報」シートに追加する非表示の追跡列(KatahimoReportId)。既存行があれば上書き、無ければ追記する。 */
  reportId: string;
  /** 'yyyy/MM/dd HH:mm:ss'(JST)。GAS版Timestamp列と同じ書式。 */
  timestampJst: string;
  startTime: string;
  endTime: string;
  staffName: string;
  customerId: string;
  customerName: string;
  inputText: string;
  internalText: string;
  customerText: string;
  riskRating: number | null;
  esRating: number | null;
}

export interface AccidentReportMirrorPayload {
  reportId: string;
  timestampJst: string;
  staffName: string;
  customerId: string;
  customerName: string;
  targetName: string;
  targetDob: string;
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
  inputText: string;
  reportType: string;
}

export interface ReceiptMirrorPayload {
  staffName: string;
  customerId: string;
  customerName: string;
  /** 'yyyy/MM/dd HH:mm:ss'(JST)。OCR取得日時 or 登録時刻(GAS版processReceiptImagesと同じ)。 */
  receiptTimestampJst: string;
  amount: string;
  storeName: string;
  handoffText: string;
  /** data URL('data:image/jpeg;base64,...')。GAS版Driveアップロードにそのまま使う。 */
  imageDataUrl: string;
}

export interface AttendanceDayMirrorPayload {
  staffName: string;
  /** 'YYYY-MM-DD' */
  businessDate: string;
  /** PAST_SCHEDULE_INPUT_COLUMNSの列記号(C/D/E等)をキーにした入力値。 */
  values: Record<string, string>;
}

export interface MirrorSenderPort {
  sendDailyReport(payload: DailyReportMirrorPayload): Promise<void>;
  sendAccidentReport(payload: AccidentReportMirrorPayload): Promise<void>;
  sendReceipt(payload: ReceiptMirrorPayload): Promise<void>;
  sendAttendanceDay(payload: AttendanceDayMirrorPayload): Promise<void>;
}
