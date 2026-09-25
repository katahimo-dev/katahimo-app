import { normalizeRetirementDate } from '@katahimo/core/domain';
import type { StaffMasterRow } from '@katahimo/core/usecases';
import { parse } from 'csv-parse/sync';

/**
 * GAS版スタッフ台帳(Staffシート)の列位置。GAS版Auth.jsが参照している列と同じ
 * (0始まりの列番号。B=氏名、E=ログインID、H=退職日、J=パスワード、K=管理者フラグ、M=サブメール)。
 * 列位置の知識はこのファイルだけに閉じ込める。
 */
const STAFF_MASTER_COLUMNS = {
  name: 1, // B列(verifyLoginの userRow[1])
  email: 4, // E列(STAFF_LOGIN_EMAIL_COL_IDX_)
  retiredOn: 7, // H列
  password: 9, // J列(SHA-256ハッシュ、または移行前の平文)
  isAdmin: 10, // K列(1なら管理者)
  altEmail: 12, // M列(STAFF_ALT_EMAIL_COL_IDX_。'@'を含む場合だけメールアドレスとして扱う)
} as const;

function cell(row: string[], index: number): string {
  return (row[index] ?? '').trim();
}

export interface ParsedStaffMaster {
  rows: StaffMasterRow[];
  /** 退職日の表記が解釈できなかった行(退職日なしとして取り込む)。 */
  warnings: { rowNumber: number; message: string }[];
}

/**
 * スタッフ台帳をCSVとして書き出したもの(Googleスプレッドシートの「ファイル→ダウンロード→CSV」、
 * UTF-8)を読み、1行目のヘッダーを除いた各行を StaffMasterRow に変換する。
 * 全列が空の行は読み飛ばす。
 */
export function parseStaffMasterCsv(text: string): ParsedStaffMaster {
  const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = parse(content, { relax_column_count: true, skip_empty_lines: true }) as string[][];
  const result: ParsedStaffMaster = { rows: [], warnings: [] };

  records.forEach((record, index) => {
    if (index === 0) return;
    if (record.every((v) => !v.trim())) return;
    const rowNumber = index + 1;

    const rawRetirement = cell(record, STAFF_MASTER_COLUMNS.retiredOn);
    const retiredOn = rawRetirement ? normalizeRetirementDate(rawRetirement) : null;
    if (rawRetirement && !retiredOn) {
      result.warnings.push({
        rowNumber,
        message: `退職日「${rawRetirement}」を解釈できないため空として扱います`,
      });
    }
    const altEmail = cell(record, STAFF_MASTER_COLUMNS.altEmail);

    result.rows.push({
      rowNumber,
      name: cell(record, STAFF_MASTER_COLUMNS.name),
      email: cell(record, STAFF_MASTER_COLUMNS.email),
      altEmail: altEmail.includes('@') ? altEmail : null,
      password: record[STAFF_MASTER_COLUMNS.password] ?? '',
      isAdmin: cell(record, STAFF_MASTER_COLUMNS.isAdmin) === '1',
      retiredOn,
    });
  });
  return result;
}
