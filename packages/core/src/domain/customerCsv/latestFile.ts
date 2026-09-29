/**
 * 顧客CSV(RESERVAの顧客エクスポート「Kokyaku_YYYYMMDDHHmm.csv」、末尾に「_N」が付くこともある)の
 * 取込対象ファイル選び。
 *
 * 移植元: gas-childcare-visit-app/CsvImport.js の checkAndImportLatestCsv(GAS版は「_N」を必須にしていたが、
 * RESERVAが実際にエクスポートするファイル名には付かないことがあるため、無くても取り込めるようにする)。
 * ファイル名の YYYYMMDDHHmm(エクスポート日時)を版として扱い、最も新しいものを選ぶ。
 * 最後に取り込んだ版以下なら取り込まない(同じファイルの再取込を防ぐ)。
 */

export const CUSTOMER_CSV_FILE_PATTERN = /^Kokyaku_(\d{12})(?:_\d+)?\.csv$/;

export interface LatestCustomerCsv<T> {
  file: T;
  /** ファイル名の YYYYMMDDHHmm 部分。 */
  version: string;
}

/** 命名規則に合うファイルのうち版が最も新しいもの(同じ版が複数あれば先に見つかった方)。 */
export function pickLatestCustomerCsv<T extends { name: string }>(
  files: readonly T[],
): LatestCustomerCsv<T> | null {
  let latest: LatestCustomerCsv<T> | null = null;
  for (const file of files) {
    const version = CUSTOMER_CSV_FILE_PATTERN.exec(file.name)?.[1];
    if (!version) continue;
    if (!latest || Number(version) > Number(latest.version)) latest = { file, version };
  }
  return latest;
}

/** 最後に取り込んだ版(未取込ならnull)より新しいか。 */
export function isNewerCustomerCsvVersion(version: string, lastImportedVersion: string | null): boolean {
  return Number(version) > (Number(lastImportedVersion) || 0);
}
