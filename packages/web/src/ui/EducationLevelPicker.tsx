import { DEFAULT_EDUCATION_LEVEL, REPORT_LEVELS } from '@katahimo/shared';

/**
 * 家庭の教育思考★(1〜5)を選ぶボタンの並び(読み上げではラジオボタン)。未設定は★2 として扱うことを添える。
 * labelId は見出しの要素の id。
 */
export function EducationLevelPicker({
  labelId,
  educationLevel,
  disabled,
  onSelect,
}: {
  labelId: string;
  /** 未設定は null、読み込み中は undefined(押せない) */
  educationLevel: number | null | undefined;
  disabled: boolean;
  onSelect: (level: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div role="radiogroup" aria-labelledby={labelId} className="flex gap-1">
        {REPORT_LEVELS.map((level) => {
          const on = typeof educationLevel === 'number' && level <= educationLevel;
          return (
            // biome-ignore lint/a11y/useSemanticElements: 押しやすい大きさのボタンの並びを、読み上げではラジオボタンにする
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={educationLevel === level}
              aria-label={`★${level}`}
              disabled={disabled || educationLevel === undefined}
              onClick={() => onSelect(level)}
              className={`min-h-11 min-w-11 px-2 rounded-xl text-base font-bold border disabled:opacity-60 ${
                on
                  ? 'bg-yellow-100 border-yellow-400 text-yellow-800'
                  : 'bg-white border-gray-300 text-gray-600'
              }`}
            >
              {`★${level}`}
            </button>
          );
        })}
      </div>
      {educationLevel === null ? (
        <span className="text-sm text-gray-600">{`未設定（★${DEFAULT_EDUCATION_LEVEL}として書きます）`}</span>
      ) : null}
    </div>
  );
}
