import { PASSWORD_RESET_CODE_LENGTH } from '@katahimo/shared';

/**
 * 再設定コードの欄の入力を数字だけにそろえる(全角の数字は半角に、空白・ハイフン等は除く)。メールから
 * 「1234 5678」のように貼り付けても、日本語入力のまま全角で打っても通るように。桁数を超えた分は切る。
 */
export function normalizeResetCodeInput(value: string): string {
  return value
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
    .slice(0, PASSWORD_RESET_CODE_LENGTH);
}
