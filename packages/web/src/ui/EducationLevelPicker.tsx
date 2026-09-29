import {
  DEFAULT_EDUCATION_LEVEL,
  EDUCATION_LEVEL_DEFINITIONS,
  type UiConfigResponse,
} from '@katahimo/shared';
import { type ReactNode, useState } from 'react';
import { Modal, ModalFooter, ModalHeader } from './modal';
import { StarRating } from './StarRating';

type EducationLevelDefinitions = UiConfigResponse['educationLevels'];

/**
 * 家庭の教育思考★(★1〜5)。日報の PSI と同じ★で選び、★の下に選んだ段階の呼称と教育語の使い方を出す。
 * 「❓ 説明」で段階ごとの説明(呼称・想定顧客像・教育語の使い方)の表を開く。未設定(null)は日報を★2(標準)で
 * 書くので、★2 を選んだ状態で見せる(未設定と★2 は同じ書き方になり分ける意味が無いため、「☆0 未設定」は置かない)。
 * 説明はテナントの「日報AIの調整」の教育思考★(GET /api/ui-config)、読み込み前は既定の文言。
 */
export function EducationLevelPicker({
  labelId,
  heading,
  educationLevel,
  disabled,
  onSelect,
  definitions = EDUCATION_LEVEL_DEFINITIONS,
}: {
  /** 見出しの要素の id(heading を渡したときはこの部品が付ける)。 */
  labelId: string;
  /** 見出し(渡すと「❓ 説明」と並べて出す。渡さなければ呼び出し側が labelId の見出しを置く)。 */
  heading?: ReactNode;
  /** 未設定は null、読み込み中は undefined(押せない) */
  educationLevel: number | null | undefined;
  /** 保存中(押しても何もしない。キーボードのフォーカスは★に残す) */
  disabled: boolean;
  onSelect: (level: number) => void;
  definitions?: EducationLevelDefinitions | undefined;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  // 未設定は★2(DEFAULT_EDUCATION_LEVEL)として見せる
  const effective = educationLevel === undefined ? undefined : (educationLevel ?? DEFAULT_EDUCATION_LEVEL);
  const selected = definitions.levels.find((l) => l.score === effective);
  const helpButton = (
    <button
      type="button"
      onClick={() => setHelpOpen(true)}
      className="min-h-11 px-3 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold whitespace-nowrap flex-shrink-0"
    >
      ❓ 説明
    </button>
  );
  return (
    <div>
      {heading ? (
        <div className="flex items-center gap-1 mb-1">
          <span id={labelId} className="text-base font-bold text-gray-800">
            {heading}
          </span>
          {helpButton}
        </div>
      ) : null}
      <div className="flex items-center gap-2 flex-wrap">
        <StarRating
          labelledBy={labelId}
          score={effective ?? 0}
          disabled={educationLevel === undefined}
          busy={disabled}
          starLabel={(value) => `★${value}`}
          onRate={(value) => {
            // 見えている★(未設定なら★2)と同じなら保存しない
            if (value !== effective) onSelect(value);
          }}
        />
        {heading ? null : helpButton}
      </div>
      <div className="text-base font-bold text-gray-700 mt-1" aria-live="polite">
        {selected ? `★${selected.score} ${selected.label}` : ''}
      </div>
      {selected ? <p className="text-sm text-gray-600">{`教育語: ${selected.usage}`}</p> : null}
      <EducationLevelHelpModal open={helpOpen} definitions={definitions} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

/** 教育思考★の段階ごとの説明(お客様の日報キーワード表現マスター「03 教育思考レベル定義」と同じ表)。 */
function EducationLevelHelpModal({
  open,
  definitions,
  onClose,
}: {
  open: boolean;
  definitions: EducationLevelDefinitions;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="educationLevelHelpTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[65] flex items-center justify-center transition-opacity"
    >
      <div className="bg-white w-full max-w-lg mx-4 rounded-2xl border border-gray-200 flex flex-col max-h-[80vh] transform transition-transform scale-95">
        <ModalHeader title={definitions.title} titleId="educationLevelHelpTitle" onClose={onClose} />
        <div className="p-4 overflow-y-auto text-gray-700 space-y-3">
          <p className="text-sm text-gray-600">
            日報のAIが、保護者に送る文で教育の言葉をどのくらい使うかの目安です。選んでいないご家庭は★
            {DEFAULT_EDUCATION_LEVEL}
            (標準)として書きます。その日のPSI(ヒヤッとした度合い)が低いときは★より優先し、教育の言葉を控えます。
          </p>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-2 text-sm w-12">★</th>
                <th className="p-2 text-sm">呼称・想定顧客像</th>
                <th className="p-2 text-sm">教育語の使い方</th>
              </tr>
            </thead>
            <tbody>
              {definitions.levels.map((l) => (
                <tr key={l.score} className="border-b align-top">
                  <td className="p-2 text-lg font-bold text-center text-yellow-500">{`★${l.score}`}</td>
                  <td className="p-2 text-sm">
                    <span className="block font-bold">{l.label}</span>
                    <span className="block text-gray-600 whitespace-pre-wrap">{l.customerProfile}</span>
                  </td>
                  <td className="p-2 text-sm text-gray-600 whitespace-pre-wrap">{l.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 px-4 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            閉じる
          </button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
