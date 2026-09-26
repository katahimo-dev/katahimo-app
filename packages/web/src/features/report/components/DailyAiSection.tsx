import { EducationLevelPicker } from '../../../ui/EducationLevelPicker';
import { calculateAge } from '../model/age';
import { cx } from './cx';

export interface DailyAiChild {
  id: string;
  name: string;
  /** 'yyyy/MM/dd'(分からなければ空) */
  dob: string;
}

/**
 * 日報AIの言葉選びの材料(日報モードのとき、AI に書いてもらう前に選ぶ)。
 * - 対象のお子様: 月齢に合った言葉を選ぶ(1人だけなら最初から選んでおく。選ばなければ年齢に合わせた言葉は使わない)
 * - 家庭の教育思考★: 教育の言葉をどのくらい使うか(スタッフ全員が変えられる。未設定は★2 として扱う)
 */
export function DailyAiSection({
  hidden,
  childrenOfFamily,
  childId,
  today,
  educationLevel,
  savingLevel,
  onSelectChild,
  onSetLevel,
}: {
  hidden: boolean;
  childrenOfFamily: readonly DailyAiChild[];
  childId: string;
  /** 業務日 'YYYY-MM-DD' */
  today: string;
  /** 家庭の★(未設定は null、読み込み中は undefined) */
  educationLevel: number | null | undefined;
  savingLevel: boolean;
  onSelectChild: (childId: string) => void;
  onSetLevel: (level: number) => void;
}) {
  return (
    <div
      id="dailyAiSection"
      className={cx('p-3 bg-blue-50 rounded-lg border border-blue-100 space-y-3', hidden && 'hidden')}
    >
      {childrenOfFamily.length > 0 ? (
        <div>
          <label htmlFor="dailyAiChild" className="block text-base font-bold text-gray-700 mb-1">
            日報のお子様
          </label>
          <select
            id="dailyAiChild"
            value={childId}
            onChange={(e) => onSelectChild(e.target.value)}
            className="w-full p-3 text-base border-gray-300 rounded-xl"
          >
            <option value="">選ばない（年齢に合わせた言葉を使わない）</option>
            {childrenOfFamily.map((child) => (
              <option key={child.id} value={child.id}>
                {`${child.name} ${calculateAge(child.dob, today)}`}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div>
        <div className="text-base font-bold text-gray-700 mb-1" id="dailyAiLevelLabel">
          🎓 ご家庭の教育への関心（教育思考★）
        </div>
        <EducationLevelPicker
          labelId="dailyAiLevelLabel"
          educationLevel={educationLevel}
          disabled={savingLevel}
          onSelect={onSetLevel}
        />
      </div>
    </div>
  );
}
