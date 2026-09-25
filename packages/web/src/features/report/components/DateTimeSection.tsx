import {
  type ClockTime,
  formatDateHeading,
  formatDateTimeSummary,
  HOUR_OPTIONS,
  isNextDateDisabled,
  MINUTE_OPTIONS,
} from '../model/dateTime';
import type { ReportFormState } from '../model/reportForm';
import { cx } from './cx';

const SELECT_CLASS = 'flex-1 p-3 text-base rounded-xl border border-gray-300 bg-gray-50';
const NAV_BUTTON_CLASS =
  'min-h-11 px-3 py-2 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold whitespace-nowrap';

interface DateTimeSectionProps {
  form: ReportFormState;
  today: string;
  /** お客様の指定なしの領収書では日付・時刻を出さない */
  hidden: boolean;
  onToggleEditor: () => void;
  onChangeDate: (offset: number) => void;
  onStartChange: (start: ClockTime) => void;
  onEndChange: (end: ClockTime) => void;
}

/**
 * 日付と時間(GAS版 #dateTimeSummaryRow / #modalDateSection / #modalTimeSection)。
 * ふだんは1行の確認表示だけにしておき、「変える」で日付送り・時刻選びを開く。
 * 親(space-y-4)の中で GAS版と同じ並び・同じ間隔になるよう、3つの要素をそのまま返す。
 */
export function DateTimeSection({
  form,
  today,
  hidden,
  onToggleEditor,
  onChangeDate,
  onStartChange,
  onEndChange,
}: DateTimeSectionProps) {
  const editorShown = form.dateTimeEditorOpen && !hidden;
  const nextDisabled = isNextDateDisabled(form.reportDate, today);
  return (
    <>
      <div
        id="dateTimeSummaryRow"
        className={cx(
          'flex items-center justify-between gap-3 bg-gray-50 border border-gray-300 rounded-xl p-3',
          hidden && 'hidden',
        )}
      >
        <div id="dateTimeSummaryText" className="text-base font-bold text-gray-800 min-w-0 break-words">
          {formatDateTimeSummary({
            mode: form.mode,
            date: form.reportDate,
            start: form.start,
            end: form.end,
            occurrenceTime: form.accident.occurrenceTime,
          })}
        </div>
        <button
          type="button"
          onClick={onToggleEditor}
          id="dateTimeEditToggleBtn"
          className="min-h-11 px-3 py-2 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold flex-shrink-0 whitespace-nowrap"
        >
          {form.dateTimeEditorOpen ? '閉じる' : '変える'}
        </button>
      </div>

      <div className={cx('mb-4', !editorShown && 'hidden')} id="modalDateSection">
        <div className="flex items-center justify-between gap-3 bg-gray-50 p-2 rounded-lg border border-gray-300">
          <button type="button" onClick={() => onChangeDate(-1)} className={NAV_BUTTON_CLASS}>
            ◀ 前の日
          </button>
          <div className="text-base font-bold text-gray-800" id="currentDateDisplay">
            {formatDateHeading(form.reportDate)}
          </div>
          <button
            type="button"
            onClick={() => onChangeDate(1)}
            id="nextDateBtn"
            disabled={nextDisabled}
            className={cx(NAV_BUTTON_CLASS, nextDisabled && 'opacity-30 cursor-not-allowed')}
          >
            次の日 ▶
          </button>
        </div>
      </div>

      <div className={cx('grid grid-cols-1 gap-4', !editorShown && 'hidden')} id="modalTimeSection">
        <div>
          <label
            id="startTimeLabel"
            htmlFor="startHour"
            className="block text-base font-bold text-gray-700 mb-1"
          >
            {form.mode === 'daily' ? '始めた時間' : '起きた時間'}
          </label>
          <TimeSelect id="start" value={form.start} onChange={onStartChange} />
        </div>
        <div id="endTimeContainer" className={cx(form.mode !== 'daily' && 'hidden')}>
          <label htmlFor="endHour" className="block text-base font-bold text-gray-700 mb-1">
            終わった時間
          </label>
          <TimeSelect id="end" value={form.end} onChange={onEndChange} />
        </div>
      </div>
    </>
  );
}

function TimeSelect({
  id,
  value,
  onChange,
}: {
  id: 'start' | 'end';
  value: ClockTime;
  onChange: (value: ClockTime) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        id={`${id}Hour`}
        aria-label={id === 'start' ? '始めた時(時)' : '終わった時(時)'}
        className={SELECT_CLASS}
        value={value.hour}
        onChange={(e) => onChange({ ...value, hour: e.target.value })}
      >
        {HOUR_OPTIONS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-gray-600">:</span>
      <select
        id={`${id}Minute`}
        aria-label={id === 'start' ? '始めた時(分)' : '終わった時(分)'}
        className={SELECT_CLASS}
        value={value.minute}
        onChange={(e) => onChange({ ...value, minute: e.target.value })}
      >
        {MINUTE_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
