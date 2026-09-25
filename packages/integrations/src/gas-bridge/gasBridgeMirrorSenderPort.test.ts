import { afterEach, describe, expect, it, vi } from 'vitest';
import { GasBridgeMirrorSenderPort } from './gasBridgeMirrorSenderPort';

/** Bridge.js へ送った action と本文を記録する fetch。 */
function stubFetch(response: object = { success: true }) {
  const calls: { action: string | null; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ action: new URL(url).searchParams.get('action'), body: JSON.parse(String(init.body)) });
      return Response.json(response);
    }),
  );
  return calls;
}

const sender = () =>
  new GasBridgeMirrorSenderPort({ baseUrl: 'https://script.google.com/macros/s/x/exec', secret: 's' });

describe('GasBridgeMirrorSenderPort(Bridge.js の書き込み action)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('領収書は receiptId を付けて送る(Bridge.js が KatahimoReceiptId 列で再送を何もしないため)', async () => {
    const calls = stubFetch({ success: true, uploadedCount: 0, alreadyMirrored: true });
    await sender().sendReceipt({
      receiptId: '01a0d9c2-deab-7776-86eb-623c7adbc1b4',
      uploadBatchId: 'batch-1',
      staffName: '山田 太郎',
      customerId: 'R-001',
      customerName: '佐藤 花子',
      receiptTimestampJst: '2026/09/25 09:00:00',
      amount: '500',
      storeName: '往復バス',
      handoffText: '',
      imageDataUrl: 'data:image/jpeg;base64,/9j/4A==',
    });
    expect(calls).toEqual([
      {
        action: 'writeReceipt',
        body: expect.objectContaining({
          receiptId: '01a0d9c2-deab-7776-86eb-623c7adbc1b4',
          storeName: '往復バス',
        }),
      },
    ]);
  });

  it('事故報告は対象児の氏名・生年月日を送る(Bridge.js が5・6列目に書く)', async () => {
    const calls = stubFetch();
    await sender().sendAccidentReport({
      reportId: 'r-1',
      timestampJst: '2026/09/25 09:00:00',
      staffName: '山田 太郎',
      customerId: 'R-001',
      customerName: '佐藤 花子',
      targetName: '佐藤 一郎',
      targetDob: '2022/4/1',
      occurrenceTime: '10:00',
      location: '公園',
      accidentContent: '転倒',
      situation: '走っていた',
      immediateResponse: '冷やした',
      parentCorrespondence: '報告済み',
      diagnosisTreatment: 'なし',
      prevention: '見守り',
      inputText: 'メモ',
      reportType: 'ヒヤリハット',
    });
    expect(calls[0]).toMatchObject({
      action: 'writeAccidentReport',
      body: { reportId: 'r-1', targetName: '佐藤 一郎', targetDob: '2022/4/1', reportType: 'ヒヤリハット' },
    });
  });

  it('success:false は例外(outbox ワーカーが再試行する)', async () => {
    stubFetch({ success: false, message: 'サーバーが混み合っています。' });
    await expect(
      sender().sendAttendanceAggregate({ staffName: '山田 太郎', businessDate: '2026-09-25' }),
    ).rejects.toThrow('サーバーが混み合っています。');
  });
});
