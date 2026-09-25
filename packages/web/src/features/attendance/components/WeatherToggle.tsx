/**
 * 天候のボタン(GAS版 pastScheduleWeatherToggleHtml_ / setPastScheduleWeather_)。
 * 押したボタンが選ばれ、同じボタンをもう一度押すと選択を外す。雪には ❄️ を付ける。
 */
export function WeatherToggle({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: readonly string[];
  disabled: boolean;
  onChange: (pressed: string) => void;
}) {
  return (
    <div className="w-full">
      <span className="block text-sm text-gray-600 mb-1">天候</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = option === value;
          // 押した直後の active:bg-gray-50 が選択中の青を上書きしないよう、選択中には付けない
          const cls = selected
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white text-gray-600 border-gray-300 active:bg-gray-50';
          return (
            <button
              key={option}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(option)}
              className={`weather-toggle-btn min-h-11 px-3 py-2 rounded-xl border text-sm font-bold transition-colors ${cls}`}
            >
              {option === '雪' ? '❄️ ' : ''}
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
