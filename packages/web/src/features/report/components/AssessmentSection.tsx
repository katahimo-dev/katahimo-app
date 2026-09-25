import type { UiConfigResponse } from '@katahimo/shared';
import type { KeyboardEvent } from 'react';
import type { RatingType } from '../model/reportForm';
import { cx } from './cx';

const STAR_BASE = 'text-3xl w-10 h-10';
// GAS版は focus:outline-none だけ。キーボードで選んでいる星が分かるよう、キーボードのときだけ輪を出す
const STAR_TAIL =
  'active:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded';

const QUESTIONS: { type: RatingType; label: string }[] = [
  { type: 'risk', label: '⚠️ 今日のヒヤッとした度合い（PSI）' },
  { type: 'es', label: '😊 今日の働きやすさ（ES）' },
];

/**
 * 星で答える2つの質問(日報モードのみ。GAS版 #assessmentSection / setRating / updateStarDisplay)。
 * 1番目の★が選ばれているときにもう一度押すと、未評価に戻る。
 */
export function AssessmentSection({
  hidden,
  ratings,
  assessments,
  onRate,
  onShowHint,
}: {
  hidden: boolean;
  ratings: Record<RatingType, number>;
  assessments: UiConfigResponse['assessments'] | undefined;
  onRate: (type: RatingType, score: number) => void;
  onShowHint: (type: RatingType) => void;
}) {
  return (
    <div
      id="assessmentSection"
      className={cx(
        'grid grid-cols-1 gap-4 mt-4 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100',
        hidden && 'hidden',
      )}
    >
      {QUESTIONS.map((q) => {
        const score = ratings[q.type];
        const levelLabel = assessments?.[q.type].levels.find((l) => l.score === score)?.label ?? '';
        return (
          <div key={q.type}>
            <div className="flex items-center gap-1 mb-1">
              <span className="text-base font-bold text-gray-800">{q.label}</span>
              <button
                type="button"
                onClick={() => onShowHint(q.type)}
                className="min-h-11 px-3 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold whitespace-nowrap flex-shrink-0"
              >
                ❓ 説明
              </button>
            </div>
            <div className="flex flex-col items-start gap-1">
              <StarRating
                id={`star-${q.type}`}
                label={q.label}
                score={score}
                onRate={(value) => onRate(q.type, value)}
              />
              <div id={`label-${q.type}`} className="text-base font-bold text-gray-700">
                {levelLabel}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 1〜5の★(読み上げ・キーボードでは「5つから1つ選ぶ」ラジオボタンのまとまり)。
 * 矢印キーで1つずつ動かせる。Tab で入るのは選んでいる★(未評価なら1つ目)だけ。
 */
function StarRating({
  id,
  label,
  score,
  onRate,
}: {
  id: string;
  label: string;
  score: number;
  onRate: (value: number) => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = Math.min(5, Math.max(1, (score || 0) + step));
    if (next === score) return;
    onRate(next);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next - 1]?.focus();
  };
  return (
    <div className="flex gap-0.5" id={id} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {[1, 2, 3, 4, 5].map((value) => (
        // biome-ignore lint/a11y/useSemanticElements: 見た目・押し方はGAS版の★ボタンのまま、読み上げだけラジオボタンにする
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === score}
          aria-label={`${value}`}
          tabIndex={value === (score || 1) ? 0 : -1}
          onClick={() => onRate(value)}
          className={cx(STAR_BASE, value <= score ? 'text-yellow-400' : 'text-gray-300', STAR_TAIL)}
        >
          ★
        </button>
      ))}
    </div>
  );
}
