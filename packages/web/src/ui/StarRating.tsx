import type { KeyboardEvent } from 'react';

const STAR_BASE = 'text-3xl w-10 h-10';
// GAS版は focus:outline-none だけ。キーボードで選んでいる星が分かるよう、キーボードのときだけ輪を出す
const STAR_TAIL =
  'active:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded disabled:opacity-60';

/**
 * 1〜5の★(読み上げ・キーボードでは「5つから1つ選ぶ」ラジオボタンのまとまり)。日報の PSI・ES と家庭の教育思考★で使う。
 * 矢印キーで1つずつ動かせる。Tab で入るのは選んでいる★(未選択なら先頭)だけ。
 * zeroLabel を渡すと先頭に「☆0」(未選択に戻す)を置く(score 0 = 未選択)。
 */
export function StarRating({
  id,
  label,
  labelledBy,
  score,
  onRate,
  disabled = false,
  busy = false,
  zeroLabel,
  starLabel = String,
}: {
  id?: string;
  label?: string;
  labelledBy?: string;
  /** 0 は未選択。 */
  score: number;
  onRate: (value: number) => void;
  disabled?: boolean;
  /**
   * 保存中など、いまは選べない(押しても何もしない)。disabled と違ってボタンは押せる状態のまま残すので、キーボードで
   * 選んでいる★からフォーカスが外れない。
   */
  busy?: boolean;
  /** 「☆0」の読み上げ名(例「未設定」)。渡さなければ「☆0」を出さない。 */
  zeroLabel?: string;
  /** ★ごとの読み上げ名(既定は数字だけ)。 */
  starLabel?: (value: number) => string;
}) {
  const min = zeroLabel ? 0 : 1;
  const values = zeroLabel ? [0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5];
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : 0;
    if (step === 0 || disabled || busy) return;
    e.preventDefault();
    const next = Math.min(5, Math.max(min, (score || 0) + step));
    if (next === score) return;
    onRate(next);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next - min]?.focus();
  };
  const focusable = score || min;
  const rate = (value: number) => {
    if (!busy) onRate(value);
  };
  return (
    <div
      className="flex items-center gap-0.5"
      id={id}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-busy={busy || undefined}
      onKeyDown={onKeyDown}
    >
      {values.map((value) =>
        value === 0 ? (
          // biome-ignore lint/a11y/useSemanticElements: ★と同じ並びのボタンを、読み上げではラジオボタンにする
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={score === 0}
            aria-label={zeroLabel}
            tabIndex={focusable === 0 ? 0 : -1}
            disabled={disabled}
            onClick={() => rate(0)}
            aria-disabled={busy || undefined}
            className={`mr-1 min-h-10 px-2 rounded-lg border text-sm font-bold ${
              score === 0
                ? 'bg-gray-700 text-white border-gray-700'
                : 'bg-white text-gray-600 border-gray-300'
            } ${STAR_TAIL}`}
          >
            ☆0
          </button>
        ) : (
          // biome-ignore lint/a11y/useSemanticElements: 見た目・押し方はGAS版の★ボタンのまま、読み上げだけラジオボタンにする
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === score}
            aria-label={starLabel(value)}
            tabIndex={value === focusable ? 0 : -1}
            disabled={disabled}
            onClick={() => rate(value)}
            aria-disabled={busy || undefined}
            className={`${STAR_BASE} ${value <= score ? 'text-yellow-400' : 'text-gray-300'} ${STAR_TAIL}`}
          >
            ★
          </button>
        ),
      )}
    </div>
  );
}
