import type { AttendanceRowData } from '../api';

interface FieldProps {
  label: string;
  fieldKey: keyof AttendanceRowData;
  type?: string;
  value: AttendanceRowData;
  onChange: (key: keyof AttendanceRowData, value: string) => void;
}

function Field({ label, fieldKey, type = 'text', value, onChange }: FieldProps) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-0.5" htmlFor={`move-${fieldKey}`}>
        {label}
      </label>
      <input
        id={`move-${fieldKey}`}
        type={type}
        value={value[fieldKey] ?? ''}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        className="w-full p-2 border border-gray-300 rounded text-sm"
      />
    </div>
  );
}

/**
 * 「移動・距離・その他」パネル。特定の予定(訪問・事務作業)に紐づかない、その日全体の
 * 項目をまとめて1か所で編集する。GAS版のpastScheduleDetailPanelと同じ役割・見た目。
 */
export function MoveDistancePanel({
  rowData,
  onChange,
  onSave,
  saving,
}: {
  rowData: AttendanceRowData;
  onChange: (key: keyof AttendanceRowData, value: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-4">
      <div className="text-xs font-bold text-gray-600 mb-2">移動・距離・その他</div>

      <div className="space-y-3 mb-3">
        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-1">出勤(自宅→#1)</div>
          <div className="grid grid-cols-1 gap-2">
            <Field label="出勤距離(km)" fieldKey="AI" type="number" value={rowData} onChange={onChange} />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-1">#1→#2移動</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="移動時間(分)" fieldKey="H" type="number" value={rowData} onChange={onChange} />
            <Field label="天候(雪で1.3倍)" fieldKey="I" value={rowData} onChange={onChange} />
            <Field label="移動距離(km)" fieldKey="AG" type="number" value={rowData} onChange={onChange} />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-1">#2→#3移動</div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="移動時間(分)" fieldKey="Q" type="number" value={rowData} onChange={onChange} />
            <Field label="天候" fieldKey="R" value={rowData} onChange={onChange} />
            <Field label="移動距離(km)" fieldKey="AH" type="number" value={rowData} onChange={onChange} />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-1">退勤(#3→自宅)</div>
          <div className="grid grid-cols-1 gap-2">
            <Field label="退勤距離(km)" fieldKey="AJ" type="number" value={rowData} onChange={onChange} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <Field label="買物代行(回数)" fieldKey="AN" type="number" value={rowData} onChange={onChange} />
        <Field label="備考" fieldKey="AO" value={rowData} onChange={onChange} />
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg transition-colors"
      >
        {saving ? '保存中…' : '保存する'}
      </button>
    </div>
  );
}
