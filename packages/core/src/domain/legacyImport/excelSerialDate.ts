/**
 * Google Sheets/Excel のシリアル日時(1899-12-30を起点とした経過日数、小数部が時刻)を
 * ISO8601文字列に変換する。
 *
 * RESERVA(外部予約システム)の顧客CSVの「登録日時」「最終更新日時」列は、テキストCSVの
 * 時点で既にこの形式の数値文字列("45882.55"等)になっている(スプレッドシート側の表示形式では
 * なく、エクスポートされた生のCSVテキストがこの形式)。ここで変換しないと、日時情報を
 * 意味のある形で保持できない。
 */
export function excelSerialDateToIso(serial: string | number): string | null {
  const value = typeof serial === 'number' ? serial : Number.parseFloat(serial);
  if (!Number.isFinite(value)) return null;

  const EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
  const ms = EPOCH_UTC_MS + value * 86_400_000;
  return new Date(ms).toISOString();
}
