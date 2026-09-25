import { calculateAge } from '../model/age';
import { cx } from './cx';

/**
 * 「対象のお子様」(事故モードのときだけ出す。GAS版 #familySelectorContainer / onFamilySelect)。
 * 選ぶと事故報告書の「お子様の名前」「生まれた日」に入る。
 */
export function FamilySelector({
  hidden,
  family,
  value,
  today,
  onSelect,
}: {
  hidden: boolean;
  family: readonly { name: string; dob: string }[];
  value: string;
  today: Date;
  onSelect: (index: string) => void;
}) {
  return (
    <div id="familySelectorContainer" className={cx('-mx-4 px-4 py-3 bg-blue-50', hidden && 'hidden')}>
      <label htmlFor="familySelector" className="block text-base font-bold text-gray-700 mb-1">
        対象のお子様
      </label>
      <select
        id="familySelector"
        value={value}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full p-3 text-base border-gray-300 rounded-xl mb-2"
      >
        <option value="">お子様を選んでください</option>
        {family.map((member, idx) => (
          // 世帯構成員は並び順だけで区別する(GAS版と同じく番号を値にする)
          // biome-ignore lint/suspicious/noArrayIndexKey: 並び順そのものが値
          <option key={idx} value={String(idx)}>
            {`${member.name} ${calculateAge(member.dob, today)}`}
          </option>
        ))}
      </select>
    </div>
  );
}
