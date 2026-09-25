import { describe, expect, it } from 'vitest';
import { checkAttendanceEditable, editableRangeFor } from './monthLock';

describe('月ロック(GAS版 updatePastSchedule)', () => {
  it('編集できるのは今日が属する月の1日〜末日', () => {
    expect(editableRangeFor('2026-09-25')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(editableRangeFor('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('当月内は編集できる', () => {
    expect(checkAttendanceEditable('2026-09-01', '2026-09-25')).toEqual({ editable: true });
    expect(checkAttendanceEditable('2026-09-30', '2026-09-25')).toEqual({ editable: true });
  });

  it('前月以前・来月以降はGAS版と同じ文言で拒否する', () => {
    expect(checkAttendanceEditable('2026-08-31', '2026-09-25')).toEqual({
      editable: false,
      reason: 'before_current_month',
      message: '修正期限切れです。当月(09/01)より前の記録は変更できません。',
    });
    expect(checkAttendanceEditable('2026-10-01', '2026-09-25')).toEqual({
      editable: false,
      reason: 'after_current_month',
      message: '修正できません。来月以降(09/30より後)の記録はまだ修正できません。',
    });
  });
});
