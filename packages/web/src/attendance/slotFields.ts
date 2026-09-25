import type { AttendanceRowData, ScheduleEvent } from '../api';

/** スロットキーと、対応するrowDataの名前/始業/終業キーの対応。GAS版PastSchedule.jsのbuildScheduleEventsFromRowData_と同じ対応。 */
export const SLOT_FIELD_KEYS: Record<
  ScheduleEvent['slotKey'],
  {
    name: keyof AttendanceRowData;
    start: keyof AttendanceRowData;
    end: keyof AttendanceRowData;
    label: string;
  }
> = {
  slot1: { name: 'C', start: 'D', end: 'E', label: '訪問その1' },
  slot2: { name: 'L', start: 'M', end: 'N', label: '訪問その2' },
  slot3: { name: 'U', start: 'V', end: 'W', label: '訪問その3' },
  office1: { name: 'X', start: 'Y', end: 'Z', label: '事務作業その1' },
  office2: { name: 'AA', start: 'AB', end: 'AC', label: '事務作業その2' },
};

export const ALL_SLOT_KEYS: ScheduleEvent['slotKey'][] = ['slot1', 'slot2', 'slot3', 'office1', 'office2'];
