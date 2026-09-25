import { describe, expect, it } from 'vitest';
import {
  buildAccidentReportNotificationText,
  buildDailyReportNotificationText,
  buildReceiptNotificationText,
} from './notificationText';

describe('buildDailyReportNotificationText', () => {
  it('GAS版saveReportのlwText組み立てと同じ(評価あり)', () => {
    const text = buildDailyReportNotificationText({
      staffName: '山田',
      customerName: '田中様',
      content: { startTime: '10:00', endTime: '11:00', internalText: '本文' },
      riskRating: 3,
      esRating: 5,
    });
    expect(text).toBe(
      '【日報提出】\n担当: 山田\n顧客名: 田中様\n訪問時間: 10:00〜11:00\n【評価指標】\nPSI: ★★★☆☆ (3)\n満足度: ★★★★★ (5)\n\n本文',
    );
  });

  it('評価未入力・時刻未入力でも成立する', () => {
    const text = buildDailyReportNotificationText({
      staffName: '山田',
      customerName: '田中様',
      content: { startTime: '', endTime: '', internalText: '本文2' },
      riskRating: null,
      esRating: null,
    });
    expect(text).toBe('【日報提出】\n担当: 山田\n顧客名: 田中様\n訪問時間: \n\n本文2');
  });
});

describe('buildAccidentReportNotificationText', () => {
  it('GAS版saveAccidentReportのlwText組み立てと同じ', () => {
    const text = buildAccidentReportNotificationText({
      staffName: '山田',
      customerName: '田中様',
      reportType: '事故報告',
      content: {
        targetName: '太郎',
        targetDob: '2020/01/01',
        occurrenceTime: '10時頃',
        location: 'リビング',
        accidentContent: '転倒',
        situation: '走っていた',
        immediateResponse: '冷却',
        parentCorrespondence: '電話済み',
        diagnosisTreatment: '診療前',
        prevention: '見守り強化',
        inputText: '元メモ',
      },
    });
    expect(text).toBe(
      [
        '【事故報告】',
        '担当: 山田',
        '顧客名: 田中様',
        '対象: 太郎',
        '生年月日: 2020/01/01',
        '発生日時: 10時頃',
        '発生場所: リビング',
        '事故内容: 転倒',
        '発生状況: 走っていた',
        '発生時の対応: 冷却',
        '保護者への対応: 電話済み',
        '診断名および処置状況: 診療前',
        '今後の対応: 見守り強化',
      ].join('\n'),
    );
  });
});

describe('buildReceiptNotificationText', () => {
  it('GAS版uploadReceiptsOnlyのlwMsg組み立てと同じ', () => {
    const text = buildReceiptNotificationText({
      staffName: '鈴木',
      customerName: '佐藤様',
      receiptTimestamp: '2026/08/28 12:00:00',
      registeredImages: [{ amount: '1000', storeName: 'コンビニ' }],
      handoffText: '  よろしく  ',
    });
    expect(text).toBe(
      '【領収書登録】\n担当: 鈴木\n顧客名: 佐藤様\n日付: 2026/08/28\n名称: コンビニ / 金額: 1000円\n\n申し送り:\nよろしく',
    );
  });

  it('顧客名・申し送りが無い場合はその行を省略する', () => {
    const text = buildReceiptNotificationText({
      staffName: '鈴木',
      customerName: null,
      receiptTimestamp: '2026/08/28 12:00:00',
      registeredImages: [{ amount: '', storeName: '' }],
      handoffText: '',
    });
    expect(text).toBe('【領収書登録】\n担当: 鈴木\n日付: 2026/08/28\n名称: 未入力 / 金額: 未入力');
  });
});
