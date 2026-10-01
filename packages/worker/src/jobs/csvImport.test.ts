import type { CustomerCsvImportResult } from '@katahimo/ingestion';
import { describe, expect, it } from 'vitest';
import { countsAsCsvImportSuccess } from './csvImport';

const result = (patch: Partial<CustomerCsvImportResult>): CustomerCsvImportResult => ({
  status: 'up_to_date',
  message: '',
  fileName: null,
  version: null,
  stats: null,
  dataVersion: '1',
  ...patch,
});

describe('countsAsCsvImportSuccess(顧客CSVの定期取込の終了コード)', () => {
  it('取込・取込済み・未設定・ファイル無しは成功', () => {
    for (const status of ['imported', 'up_to_date', 'not_configured', 'no_files'] as const) {
      expect(countsAsCsvImportSuccess(result({ status }))).toBe(true);
    }
  });

  it('失敗と、新しく安全装置が止めた版は失敗(アラートが出る。再試行は10分後の実行)', () => {
    expect(countsAsCsvImportSuccess(result({ status: 'failed' }))).toBe(false);
    expect(countsAsCsvImportSuccess(result({ status: 'review_required' }))).toBe(false);
  });

  it('前に止めた版をもう一度見ただけと、他の取込が実行中(busy)は失敗にしない(次の回が取り込む)', () => {
    expect(countsAsCsvImportSuccess(result({ status: 'review_required', repeatedReview: true }))).toBe(true);
    expect(countsAsCsvImportSuccess(result({ status: 'busy' }))).toBe(true);
  });
});
