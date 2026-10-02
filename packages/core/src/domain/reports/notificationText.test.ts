import { describe, expect, it } from 'vitest';
import { escapeChatText } from '../notifications/chatText';
import { buildPsiAlertChatText } from '../push/psiAlert';
import {
  buildAccidentReportNotificationText,
  buildDailyReportNotificationText,
  buildReceiptCancelNotificationText,
  buildReceiptNotificationText,
  buildVisitCompleteNotificationText,
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
      registeredImages: [{ amount: '1000', storeName: 'コンビニ', companyPaid: false }],
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
      registeredImages: [{ amount: '', storeName: '', companyPaid: false }],
      handoffText: '',
    });
    expect(text).toBe('【領収書登録】\n担当: 鈴木\n日付: 2026/08/28\n名称: 未入力 / 金額: 未入力');
  });

  it('会社負担の画像は行の末尾にそう書く', () => {
    const text = buildReceiptNotificationText({
      staffName: '鈴木',
      customerName: '佐藤様',
      receiptTimestamp: '2026/08/28 12:00:00',
      registeredImages: [
        { amount: '1000', storeName: 'コンビニ', companyPaid: false },
        { amount: '600', storeName: '駐車場', companyPaid: true },
      ],
      handoffText: '',
    });
    expect(text).toBe(
      '【領収書登録】\n担当: 鈴木\n顧客名: 佐藤様\n日付: 2026/08/28\n名称: コンビニ / 金額: 1000円\n名称: 駐車場 / 金額: 600円 / 会社負担(お客様に請求しない)',
    );
  });
});

describe('buildReceiptCancelNotificationText', () => {
  it('担当・取消した人・お客様・日時・領収書の行・理由を書く', () => {
    expect(
      buildReceiptCancelNotificationText({
        staffName: '鈴木',
        cancelledByName: '管理 太郎',
        customerName: '佐藤様',
        receiptTimestamp: '2026/09/10 12:00',
        image: { amount: '600', storeName: '駐車場', companyPaid: true },
        reason: '金額の入力を間違えた',
      }),
    ).toBe(
      '【領収書取消】\n担当: 鈴木\n取消した人: 管理 太郎\n顧客名: 佐藤様\n日時: 2026/09/10 12:00\n名称: 駐車場 / 金額: 600円 / 会社負担(お客様に請求しない)\n取消の理由: 金額の入力を間違えた',
    );
  });

  it('本人の取消・お客様の指定なし・理由なしはその行を省く', () => {
    expect(
      buildReceiptCancelNotificationText({
        staffName: '鈴木',
        cancelledByName: null,
        customerName: null,
        receiptTimestamp: '2026/09/10 12:00',
        image: { amount: '', storeName: '', companyPaid: false },
        reason: null,
      }),
    ).toBe('【領収書取消】\n担当: 鈴木\n日時: 2026/09/10 12:00\n名称: 未入力 / 金額: 未入力');
  });
});

describe('Google Chat の書式の差し込み(<users/all>・<url|文字>)を防ぐ', () => {
  const hostile = '<users/all> <https://evil.example|ここを押す> & 続き';
  const escaped = '&lt;users/all&gt; &lt;https://evil.example|ここを押す&gt; &amp; 続き';

  it('escapeChatText は & < > を文字参照にする(& を先に)', () => {
    expect(escapeChatText(hostile)).toBe(escaped);
    expect(escapeChatText('&lt;')).toBe('&amp;lt;');
    expect(escapeChatText(null)).toBe('');
    expect(escapeChatText(1200)).toBe('1200');
  });

  it('全ての通知の本文で、利用者の入力・DB の値を文字参照にし、見出しはそのまま', () => {
    const texts = [
      buildDailyReportNotificationText({
        staffName: hostile,
        customerName: hostile,
        content: { startTime: hostile, endTime: hostile, internalText: hostile },
        riskRating: 3,
        esRating: null,
      }),
      buildAccidentReportNotificationText({
        staffName: hostile,
        customerName: hostile,
        reportType: '事故報告',
        content: {
          targetName: hostile,
          targetDob: hostile,
          occurrenceTime: hostile,
          location: hostile,
          accidentContent: hostile,
          situation: hostile,
          immediateResponse: hostile,
          parentCorrespondence: hostile,
          diagnosisTreatment: hostile,
          prevention: hostile,
        } as Parameters<typeof buildAccidentReportNotificationText>[0]['content'],
      }),
      buildReceiptNotificationText({
        staffName: hostile,
        customerName: hostile,
        receiptTimestamp: '2026/09/10 12:00:00',
        registeredImages: [{ amount: hostile, storeName: hostile, companyPaid: false }],
        handoffText: hostile,
      }),
      buildReceiptCancelNotificationText({
        staffName: hostile,
        cancelledByName: hostile,
        customerName: hostile,
        receiptTimestamp: hostile,
        image: { amount: '100', storeName: hostile, companyPaid: true },
        reason: hostile,
      }),
      buildVisitCompleteNotificationText({
        staffName: hostile,
        customerName: hostile,
        visitDate: '2026-09-25',
        startTime: '09:00',
        endTime: '12:00',
      }),
      buildPsiAlertChatText({
        recordId: '00000000-0000-7000-8000-000000000001',
        riskRating: 1,
        staffName: hostile,
        customerName: hostile,
        date: '2026-09-25',
      }),
    ];
    for (const text of texts) {
      expect(text).not.toContain('<');
      expect(text).not.toContain('>');
      expect(text).toContain(escaped);
    }
    expect(texts[4]).toBe(
      `【訪問完了】\n担当: ${escaped}\n顧客名: ${escaped}\n訪問日時: 2026/09/25 09:00〜12:00`,
    );
  });
});
