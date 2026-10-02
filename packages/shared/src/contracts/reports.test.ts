import { describe, expect, it } from 'vitest';
import { visitCompleteRequestSchema } from './reports';

describe('visitCompleteRequestSchema', () => {
  const base = {
    customerId: '0190a000-0000-7000-8000-000000000001',
    visitDate: '2026-10-02',
  };

  it('時刻は HH:mm か空文字。それ以外は断る', () => {
    expect(visitCompleteRequestSchema.parse({ ...base, startTime: '09:00', endTime: '' })).toMatchObject({
      startTime: '09:00',
      endTime: '',
    });
    expect(visitCompleteRequestSchema.safeParse({ ...base, startTime: '9時', endTime: '' }).success).toBe(
      false,
    );
    expect(
      visitCompleteRequestSchema.safeParse({ ...base, startTime: '09:00', endTime: '<b>' }).success,
    ).toBe(false);
  });

  it('前の版の画面が送る ":"(時刻を選んでいない)は1リリースの間だけ空文字として受け付ける(次のリリースで外す)', () => {
    expect(visitCompleteRequestSchema.parse({ ...base, startTime: ':', endTime: ':' })).toMatchObject({
      startTime: '',
      endTime: '',
    });
  });
});
