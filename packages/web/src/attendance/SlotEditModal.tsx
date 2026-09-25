import { useState } from 'react';
import type { AttendanceRowData, ScheduleEvent } from '../api';
import { SLOT_FIELD_KEYS } from './slotFields';

/**
 * 予定(訪問・事務作業)1件の編集モーダル。名称・始業・終業のみを扱う
 * (移動時間・距離・天候・買物代行・備考はMoveDistancePanelで別途、日単位でまとめて編集する)。
 * GAS版のpastScheduleSlotModalと同じ役割・見た目にしている。
 */
export function SlotEditModal({
  slotKey,
  rowData,
  onSave,
  onClose,
}: {
  slotKey: ScheduleEvent['slotKey'];
  rowData: AttendanceRowData;
  onSave: (patch: Partial<AttendanceRowData>) => void;
  onClose: () => void;
}) {
  const fields = SLOT_FIELD_KEYS[slotKey];
  const [name, setName] = useState(rowData[fields.name] ?? '');
  const [start, setStart] = useState(rowData[fields.start] ?? '');
  const [end, setEnd] = useState(rowData[fields.end] ?? '');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[120] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-xl shadow-xl flex flex-col max-h-[90vh]">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <h3 className="font-bold text-gray-800 text-sm">{fields.label}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs text-gray-500 mb-1" htmlFor="slotName">
              名称
            </label>
            <input
              id="slotName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded text-sm"
              placeholder="訪問先名等"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1" htmlFor="slotStart">
                始業
              </label>
              <input
                id="slotStart"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1" htmlFor="slotEnd">
                終業
              </label>
              <input
                id="slotEnd"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-xl flex gap-2">
          <button
            type="button"
            onClick={() => onSave({ [fields.name]: '', [fields.start]: '', [fields.end]: '' })}
            className="py-2 px-3 bg-red-50 text-red-600 border border-red-200 text-sm font-bold rounded-lg hover:bg-red-100"
          >
            削除
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 bg-gray-200 text-gray-700 text-sm font-bold rounded-lg hover:bg-gray-300"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => onSave({ [fields.name]: name, [fields.start]: start, [fields.end]: end })}
            className="flex-1 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700"
          >
            保存する
          </button>
        </div>
      </div>
    </div>
  );
}
