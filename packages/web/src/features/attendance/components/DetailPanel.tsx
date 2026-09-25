import type { AttendanceDay } from '@katahimo/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { attendanceApi } from '../../../api/attendance';
import { showErrorToast, showToast } from '../../../ui/toast';
import { type DayDetailField, type DayDetailValues, detailPatch, toDayRecord } from '../model/dayRecord';
import {
  buildMoveGroups,
  isValidShoppingCount,
  type MoveGroup,
  shownDetailFields,
  toggleWeather,
  weatherOptionsOrDefault,
} from '../model/moveGroups';
import { savedMessage } from '../model/saveMessage';
import { WeatherToggle } from './WeatherToggle';

/**
 * 「移動と距離・買い物代行・備考」パネル(GAS版 #pastScheduleDetailPanel / savePastScheduleDetail)。
 * 予定に付かない、その日全体の値をまとめて1回で保存する。直せない日は入力できず、保存ボタンも出さない。
 * 読み込み直したときに入力を戻すため、呼び出し側で key に日付と読み込んだ時刻を入れる。
 */
export function DetailPanel({
  day,
  staffId,
  onSaved,
}: {
  day: AttendanceDay;
  staffId: string | undefined;
  onSaved: () => void;
}) {
  const record = useMemo(() => toDayRecord(day.rowData), [day.rowData]);
  const groups = useMemo(() => buildMoveGroups(record), [record]);
  const [values, setValues] = useState<DayDetailValues>(record.detail);
  const set = (field: DayDetailField, value: string) => setValues((v) => ({ ...v, [field]: value }));
  const disabled = !day.editable;
  const idPrefix = useId();

  const save = useMutation({
    mutationFn: () =>
      attendanceApi.updateDay({
        date: day.businessDate,
        staffId,
        rowData: detailPatch(
          {
            ...values,
            shoppingCount:
              values.shoppingCount === '' ? '' : String(Number.parseInt(values.shoppingCount, 10)),
          },
          shownDetailFields(groups),
        ),
      }),
    onSuccess: (res) => {
      showToast(savedMessage(res));
      onSaved();
    },
    onError: (e) => showErrorToast(e),
  });

  const onSave = () => {
    if (!isValidShoppingCount(values.shoppingCount)) {
      showToast('買い物代行をした回数は、0以上の数で入力してください', true);
      return;
    }
    save.mutate();
  };

  const weatherOptions = { visit1: day.optionsI, visit2: day.optionsR };

  return (
    <div id="pastScheduleDetailPanel" className="bg-white rounded-2xl border border-gray-200 p-3 mb-4">
      <div className="text-base font-bold text-gray-800 mb-2">移動と距離・買い物代行・備考</div>
      <div className="space-y-2 mb-3">
        {groups.length === 0 ? (
          <div className="text-base text-gray-600 text-center py-2">この日は訪問さきの記録がありません</div>
        ) : (
          groups.map((group) => (
            <MoveGroupFields
              key={group.title + group.numberFields[0]?.field}
              group={group}
              values={values}
              disabled={disabled}
              idPrefix={idPrefix}
              weatherOptions={
                group.weather ? weatherOptionsOrDefault(weatherOptions[group.weather.options]) : []
              }
              onChange={set}
            />
          ))
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div>
          <label htmlFor={`${idPrefix}-shopping`} className="block text-sm text-gray-600 mb-0.5">
            買い物代行をした回数
          </label>
          <input
            id={`${idPrefix}-shopping`}
            type="number"
            step="1"
            min="0"
            value={values.shoppingCount}
            disabled={disabled}
            onChange={(e) => set('shoppingCount', e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-xl text-base"
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-remarks`} className="block text-sm text-gray-600 mb-0.5">
            備考
          </label>
          <input
            id={`${idPrefix}-remarks`}
            type="text"
            value={values.remarks}
            disabled={disabled}
            onChange={(e) => set('remarks', e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-xl text-base"
          />
        </div>
      </div>
      {day.editable ? (
        <button
          type="button"
          onClick={onSave}
          disabled={save.isPending}
          className="w-full min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl transition-colors"
        >
          {save.isPending ? '保存中...' : '保存する'}
        </button>
      ) : null}
    </div>
  );
}

function MoveGroupFields({
  group,
  values,
  disabled,
  idPrefix,
  weatherOptions,
  onChange,
}: {
  group: MoveGroup;
  values: DayDetailValues;
  disabled: boolean;
  idPrefix: string;
  weatherOptions: readonly string[];
  onChange: (field: DayDetailField, value: string) => void;
}) {
  const weather = group.weather;
  return (
    <div className="bg-gray-50 rounded-lg p-2">
      <div className="text-base font-bold text-gray-800 mb-1.5">{group.title}</div>
      <div className="flex flex-wrap gap-3 items-end">
        {group.numberFields.map(({ field, label }) => (
          <div key={field} className="flex-1 min-w-[100px]">
            <label htmlFor={`${idPrefix}-${field}`} className="block text-sm text-gray-600 mb-0.5">
              {label}
            </label>
            <input
              id={`${idPrefix}-${field}`}
              type="number"
              step="0.01"
              value={values[field]}
              disabled={disabled}
              onChange={(e) => onChange(field, e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-xl text-base"
            />
          </div>
        ))}
      </div>
      {weather ? (
        <div className="mt-2">
          <WeatherToggle
            value={values[weather.field]}
            options={weatherOptions}
            disabled={disabled}
            onChange={(pressed) => onChange(weather.field, toggleWeather(values[weather.field], pressed))}
          />
        </div>
      ) : null}
    </div>
  );
}
