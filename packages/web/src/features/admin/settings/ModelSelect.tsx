import { type ModelOption, modelOptionLabel } from './modelOptions';
import type { AdminSettingsLoadStatus } from './useAdminSettingsForm';

/** 日報用/OCR用モデルの選択(読み込み中・失敗時はGAS版と同じく1行だけの案内を出して無効にする)。 */
export function ModelSelect({
  id,
  value,
  options,
  onChange,
  status,
  className,
}: {
  id: string;
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  status: AdminSettingsLoadStatus;
  className: string;
}) {
  if (status !== 'loaded') {
    return (
      <select id={id} disabled className={className} value="">
        <option value="">{status === 'loading' ? '読み込み中...' : '取得に失敗しました'}</option>
      </select>
    );
  }
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {options.map((option) => (
        <option key={option.name} value={option.name}>
          {modelOptionLabel(option)}
        </option>
      ))}
    </select>
  );
}
