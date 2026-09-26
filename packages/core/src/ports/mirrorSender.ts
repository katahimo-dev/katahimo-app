/**
 * outboxから取り出したミラージョブ1件を、実際にGoogleスプレッドシート/Driveへ反映するポート。
 *
 * 積む側(書き込みと同じ Unit of Work で outbox_messages に積む)に対し、こちらは「送る」側。ペイロードは
 * ワーカー側のusecase(usecases/outboxWorker.ts)がDBから最新値を読み直し・
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
  /**
   * 本アプリの領収書ID。Bridge.js(Ver. 1.1.38 以降)は「領収書一覧」の KatahimoReceiptId 列(9列目)で追跡し、
   * 同じIDの再送では何もしない(Drive へのアップロード・行を二重にしない)。
   */
  receiptId: string;
  /** 1回のアップロード操作の束(単票・移行データは空文字)。 */
  uploadBatchId: string;
  staffName: string;
  customerId: string;
  /** 顧客マスタの氏名。「お客様の指定なし」の領収書はスタッフが入力した氏名(未入力なら空文字)。 */
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
  /**
   * 出勤簿の列記号(C/D/E等)をキーにした入力値。その書き込みで表示の変わった列だけを含む(空にした列は '')。
   * 含まない列はシートの値をそのまま残す(Bridge.js も values にある列だけを書く)。
   */
  values: Record<string, string>;
  /**
   * values の列のうち、手で変更された列(実体の overridden_fields)。GAS側が対応すればこの列のセル背景を
   * #fce4e4 にできる(GAS版 updatePastSchedule と同じ強調表示。doc/05_バッチ・外部連携.md 9章)。
   */
  highlightColumns: string[];
}

/**
 * 「勤怠集計」スプレッドシートの該当スタッフ・該当日の行の書き直し。行の中身(種別・移動時間・距離・
 * ルートURL)はGAS側がカレンダーとMapsから計算し直すため、渡すのは対象だけ(Bridge.js の
 * writeAttendanceAggregate の仕様)。
 */
export interface AttendanceAggregateMirrorPayload {
  staffName: string;
  /** 'YYYY-MM-DD' */
  businessDate: string;
}

export interface MirrorSenderPort {
  sendDailyReport(payload: DailyReportMirrorPayload): Promise<void>;
  sendAccidentReport(payload: AccidentReportMirrorPayload): Promise<void>;
  sendReceipt(payload: ReceiptMirrorPayload): Promise<void>;
  sendAttendanceDay(payload: AttendanceDayMirrorPayload): Promise<void>;
  sendAttendanceAggregate(payload: AttendanceAggregateMirrorPayload): Promise<void>;
}
