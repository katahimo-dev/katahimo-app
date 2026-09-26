import { describe, expect, it, vi } from 'vitest';
import {
  initialScheduleOffset,
  NOTIFICATION_CLICK_MESSAGE,
  onScheduleLink,
  openScheduleLink,
  scheduleLinkDateOfMessage,
  scheduleOffsetForDate,
  urlWithoutScheduleLink,
} from './scheduleLink';

// 2026-09-26 21:00 JST(UTC では 12:00)
const evening = new Date('2026-09-26T12:00:00Z');
// 2026-09-27 00:30 JST(UTC ではまだ 9/26)
const afterMidnight = new Date('2026-09-26T15:30:00Z');

describe('通知のリンクで開く予定タブの日', () => {
  it('明日(JST)なら「明日」、それ以外は「今日」', () => {
    expect(scheduleOffsetForDate('2026-09-27', evening)).toBe(1);
    expect(scheduleOffsetForDate('2026-09-26', evening)).toBe(0);
    // 通知を翌日(0時を過ぎて)押したら、その日は「今日」
    expect(scheduleOffsetForDate('2026-09-27', afterMidnight)).toBe(0);
    expect(scheduleOffsetForDate('2026-09-28', afterMidnight)).toBe(1);
  });

  it('起動時の URL(`?schedule=`)から決める。無い・形が違えば今日', () => {
    expect(initialScheduleOffset('?schedule=2026-09-27', evening)).toBe(1);
    expect(initialScheduleOffset('?t=demo&schedule=2026-09-27', evening)).toBe(1);
    expect(initialScheduleOffset('', evening)).toBe(0);
    expect(initialScheduleOffset('?schedule=tomorrow', evening)).toBe(0);
  });

  it('URL からリンクだけを取り除く(法人ID などは残す)', () => {
    expect(urlWithoutScheduleLink('https://app.example/?schedule=2026-09-27')).toBe('/');
    expect(urlWithoutScheduleLink('https://app.example/?t=demo&schedule=2026-09-27#top')).toBe(
      '/?t=demo#top',
    );
    expect(urlWithoutScheduleLink('https://app.example/?t=demo')).toBeNull();
  });

  it('Service Worker のメッセージ(同じオリジンの URL だけ)', () => {
    const origin = 'https://app.example';
    expect(
      scheduleLinkDateOfMessage({ type: NOTIFICATION_CLICK_MESSAGE, url: '/?schedule=2026-09-27' }, origin),
    ).toBe('2026-09-27');
    expect(
      scheduleLinkDateOfMessage(
        { type: NOTIFICATION_CLICK_MESSAGE, url: 'https://evil.example/?schedule=2026-09-27' },
        origin,
      ),
    ).toBeNull();
    expect(scheduleLinkDateOfMessage({ type: 'other', url: '/?schedule=2026-09-27' }, origin)).toBeNull();
    expect(scheduleLinkDateOfMessage({ type: NOTIFICATION_CLICK_MESSAGE, url: '/' }, origin)).toBeNull();
    expect(scheduleLinkDateOfMessage('text', origin)).toBeNull();
  });

  it('開いている予定タブに日付を知らせる(やめた後は知らせない)', () => {
    const listener = vi.fn();
    const off = onScheduleLink(listener);
    openScheduleLink('2026-09-27');
    off();
    openScheduleLink('2026-09-28');
    expect(listener.mock.calls).toEqual([['2026-09-27']]);
  });
});
