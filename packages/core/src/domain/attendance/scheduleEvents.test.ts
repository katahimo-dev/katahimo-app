import { describe, expect, it } from 'vitest';
import { buildScheduleEventsFromRowData } from './scheduleEvents';

/**
 * 期待値はGAS版 gas-childcare-visit-app/PastSchedule.js の
 * buildScheduleEventsFromRowData_ をNode上でそのまま実行した結果と一致することを確認済み。
 */
describe('buildScheduleEventsFromRowData', () => {
  it('始業・終業が両方入力されているスロットだけイベント化する(GAS版と同じ結果)', () => {
    const events = buildScheduleEventsFromRowData('2026-08-15', {
      C: '佐藤様',
      D: '09:00',
      E: '10:00',
      L: '鈴木様',
      M: '10:45',
      N: '12:00',
      X: 'MTG',
      Y: '14:00',
      Z: '15:00',
      AA: '',
      AB: '',
      AC: '',
    });

    expect(events).toEqual([
      {
        date: '2026-08-15',
        slotKey: 'slot1',
        title: '佐藤様',
        eventType: 'CUSTOMER APPOINTMENT',
        start: '09:00',
        end: '10:00',
      },
      {
        date: '2026-08-15',
        slotKey: 'slot2',
        title: '鈴木様',
        eventType: 'CUSTOMER APPOINTMENT',
        start: '10:45',
        end: '12:00',
      },
      {
        date: '2026-08-15',
        slotKey: 'office1',
        title: 'MTG',
        eventType: 'OFFICE WORK',
        start: '14:00',
        end: '15:00',
      },
    ]);
  });

  it('入力が無ければ空配列を返す', () => {
    expect(buildScheduleEventsFromRowData('2026-08-15', {})).toEqual([]);
  });

  it('始業・終業のどちらかしか無いスロットはイベント化しない', () => {
    const events = buildScheduleEventsFromRowData('2026-08-15', { C: '佐藤様', D: '09:00' });
    expect(events).toEqual([]);
  });
});
