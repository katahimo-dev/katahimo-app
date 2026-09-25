import { describe, expect, it } from 'vitest';
import { isNewerCustomerCsvVersion, pickLatestCustomerCsv } from './latestFile';

describe('顧客CSVの取込対象(GAS版 checkAndImportLatestCsv)', () => {
  it('命名規則に合うファイルのうち、ファイル名の日時が最も新しいものを選ぶ', () => {
    const latest = pickLatestCustomerCsv([
      { name: 'Kokyaku_202609010300_1.csv' },
      { name: 'Kokyaku_202609240300_2.csv' },
      { name: 'Kokyaku_202609250300_1.csv.bak' },
      { name: 'kokyaku_202612310000_1.csv' },
      { name: 'Kokyaku_202609240300_1_dummy.csv' },
      { name: 'メモ.txt' },
    ]);
    expect(latest).toEqual({ file: { name: 'Kokyaku_202609240300_2.csv' }, version: '202609240300' });
  });

  it('該当ファイルが無ければnull', () => {
    expect(pickLatestCustomerCsv([{ name: 'Kokyaku_2026_1.csv' }])).toBeNull();
  });

  it('最後に取り込んだ版より新しいときだけ取り込む', () => {
    expect(isNewerCustomerCsvVersion('202609250300', null)).toBe(true);
    expect(isNewerCustomerCsvVersion('202609250300', '202609250300')).toBe(false);
    expect(isNewerCustomerCsvVersion('202609240300', '202609250300')).toBe(false);
    expect(isNewerCustomerCsvVersion('202609260300', '202609250300')).toBe(true);
  });
});
