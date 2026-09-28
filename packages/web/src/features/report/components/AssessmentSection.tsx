import { isPsiAlert, PSI_ESCALATION_LEVEL, type UiConfigResponse } from '@katahimo/shared';
import { StarRating } from '../../../ui/StarRating';
import type { RatingType } from '../model/reportForm';
import { cx } from './cx';

const QUESTIONS: { type: RatingType; label: string }[] = [
  { type: 'risk', label: '⚠️ 今日のヒヤッとした度合い（PSI）' },
  { type: 'es', label: '😊 今日の働きやすさ（ES）' },
];

/**
 * 星で答える2つの質問(日報モードのみ。GAS版 #assessmentSection / setRating / updateStarDisplay)。
 * 1番目の★が選ばれているときにもう一度押すと、未評価に戻る。PSI は AI に書いてもらう前に付けると、日報AIが
 * 言葉を選ぶ材料になる(PSI 2 以下は保存すると管理者に知らせる)。
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
      {isPsiAlert(ratings.risk) ? (
        <p
          id="psiAlertNotice"
          role="status"
          className="text-base font-bold text-red-700 bg-red-50 rounded-xl p-3"
        >
          {ratings.risk === PSI_ESCALATION_LEVEL
            ? '🚨 危険・緊急: 安全対応を最優先し、すぐに管理者へ電話で連絡してください。保存すると管理者にも知らせます。'
            : '⚠️ 注意: 保存すると管理者に知らせます。'}
        </p>
      ) : null}
    </div>
  );
}
