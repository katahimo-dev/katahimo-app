import { describe, expect, it } from 'vitest';
import { attachmentDisposition, safeFileName } from './download';

describe('ダウンロードのファイル名', () => {
  it('ASCII の filename と RFC 5987 の UTF-8 の filename* を付ける', () => {
    const header = attachmentDisposition("出勤簿_2026年9月_山田 太郎(1)'.xlsx", 'attendance_2026-09.xlsx');
    expect(header).toBe(
      `attachment; filename="attendance_2026-09.xlsx"; filename*=UTF-8''${encodeURIComponent('出勤簿_2026年9月_山田 太郎')}%281%29%27.xlsx`,
    );
    expect(decodeURIComponent(header.split("UTF-8''")[1] ?? '')).toBe("出勤簿_2026年9月_山田 太郎(1)'.xlsx");
  });

  it('代わりの名前の ASCII 以外・引用符は _ にする', () => {
    expect(attachmentDisposition('a.xlsx', 'あ"b\\.xlsx')).toContain('filename="__b_.xlsx"');
  });

  it('ファイル名に使えない文字は _ にする', () => {
    expect(safeFileName('出勤簿_佐藤/花子:?.xlsx')).toBe('出勤簿_佐藤_花子__.xlsx');
    expect(safeFileName('  ')).toBe('download');
  });
});
