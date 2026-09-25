import type { UiConfigResponse } from '@katahimo/shared';
import { Modal, ModalFooter, ModalHeader } from '../../../ui/modal';
import type { HintContent } from '../hooks/useReportController';

/**
 * 書き方のヒント・星の質問の説明(GAS版 #hintModal / toggleHint / showAssessmentHint)。
 * 閉じても中身を残す(GAS版と同じく、閉じるあいだも同じ文が見えている)。
 */
export function HintModal({
  open,
  hint,
  assessments,
  onClose,
}: {
  open: boolean;
  hint: HintContent | null;
  assessments: UiConfigResponse['assessments'] | undefined;
  onClose: () => void;
}) {
  const definition = hint?.body.kind === 'assessment' ? assessments?.[hint.body.type] : undefined;
  return (
    <Modal
      open={open}
      onClose={onClose}
      keepMounted
      labelledBy="hintModalTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center transition-opacity"
    >
      <div className="bg-white w-full max-w-lg mx-4 rounded-2xl border border-gray-200 flex flex-col max-h-[80vh] transform transition-transform scale-95">
        <ModalHeader
          title={hint?.title ?? '事故報告書の書き方ヒント'}
          titleId="hintModalTitle"
          onClose={onClose}
        />
        <div
          className="p-6 overflow-y-auto whitespace-pre-wrap text-base leading-relaxed text-gray-700"
          id="hintContent"
        >
          {hint?.body.kind === 'text' ? hint.body.text : null}
          {definition ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="p-2 text-sm w-10">評価</th>
                  <th className="p-2 text-sm w-20">定義</th>
                  <th className="p-2 text-sm">判断基準</th>
                </tr>
              </thead>
              <tbody>
                {definition.levels.map((l) => (
                  <tr key={l.score} className="border-b">
                    <td className="p-2 text-lg font-bold text-center text-yellow-500">{l.score}</td>
                    <td className="p-2 text-sm font-bold">{l.label}</td>
                    <td className="p-2 text-sm text-gray-600 whitespace-pre-wrap">{l.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
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
