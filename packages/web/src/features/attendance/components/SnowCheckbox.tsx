/**
 * 区間の「雪」のチェック。付けるとその区間の移動時間を1.3倍にする(出勤簿の天候の列に「雪」を入れる)。
 * 天候で計算が変わるのは雪だけのため、晴れ・曇り・雨は選ばせない(GAS版は4つのボタン pastScheduleWeatherToggleHtml_)。
 */
export function SnowCheckbox({
  id,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const cls = checked ? 'bg-blue-50 border-blue-600 text-blue-800' : 'bg-white border-gray-300 text-gray-700';
  return (
    <label
      htmlFor={id}
      className={`snow-checkbox flex items-center gap-2 min-h-11 px-3 py-2 rounded-xl border text-sm font-bold ${cls} ${
        disabled ? 'opacity-60' : 'cursor-pointer'
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-5 h-5 accent-blue-600"
      />
      <span>❄️ 雪（移動時間を1.3倍にする）</span>
    </label>
  );
}
