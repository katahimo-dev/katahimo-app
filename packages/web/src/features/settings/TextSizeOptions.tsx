import { useTextSize } from '../../app/TextSizeProvider';
import type { TextSize } from '../../lib/textSize';

/** ラジオの見た目はGAS版と同じく、選択肢そのものの文字の大きさで違いが分かるようにしている。 */
const OPTIONS: { value: TextSize; label: string; labelClassName: string }[] = [
  { value: 'normal', label: 'ふつう', labelClassName: 'text-base text-gray-800' },
  { value: 'large', label: '大きい', labelClassName: 'text-lg font-bold text-gray-800' },
  { value: 'xlarge', label: 'とても大きい', labelClassName: 'text-xl font-bold text-gray-900' },
];

/** 設定の「文字の大きさ」。選んだ時点ですぐ反映・保存する(「キャンセル」でも元に戻さない。GAS版と同じ)。 */
export function TextSizeOptions() {
  const { textSize, setTextSize } = useTextSize();
  return (
    <div>
      <h4 className="font-bold text-gray-800 text-base mb-3">文字の大きさ</h4>
      <div className="space-y-3">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className="flex items-center space-x-3 min-h-12 p-3 rounded-xl border border-gray-200 cursor-pointer has-[:checked]:bg-blue-50 has-[:checked]:border-blue-200"
          >
            <input
              type="radio"
              name="textSize"
              value={option.value}
              checked={textSize === option.value}
              onChange={() => setTextSize(option.value)}
              className="w-5 h-5 text-blue-600 focus:ring-blue-500 border-gray-300"
            />
            <span className={option.labelClassName}>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
