import {
  DEMO_TERMS_AGREE,
  DEMO_TERMS_CLOSE,
  DEMO_TERMS_TITLE,
  type DemoTermsValues,
  demoTermsSections,
} from '../../../lib/demo';
import { Modal, ModalFooter } from '../../../ui/modal';

/**
 * 公開デモの注釈(共有のアカウント・保存すること・できない操作・AI・お願い)。
 * ログインした直後は「同意して始める」だけで閉じる(Escape・× では閉じない)。画面上の帯から開き直したときは「閉じる」。
 */
export function DemoTermsModal({
  open,
  afterLogin,
  values,
  onClose,
}: {
  open: boolean;
  /** ログインした直後に出しているか(false = 帯から開き直した) */
  afterLogin: boolean;
  values: DemoTermsValues | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      id="demoTermsModal"
      labelledBy="demoTermsTitle"
      onClose={afterLogin ? undefined : onClose}
      className="fixed inset-0 bg-black bg-opacity-50 z-[125] flex items-center justify-center p-4 transition-opacity"
    >
      <div className="bg-white w-full max-w-md rounded-2xl border border-gray-200 flex flex-col max-h-[85vh]">
        <div className="p-4 border-b bg-amber-50 rounded-t-2xl">
          <h3 id="demoTermsTitle" className="font-bold text-amber-900 text-base">
            {DEMO_TERMS_TITLE}
          </h3>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto text-sm text-gray-800">
          {demoTermsSections(values).map((section) => (
            <section key={section.heading} className="space-y-1">
              <h4 className="font-bold text-gray-900">{section.heading}</h4>
              {section.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {section.items ? (
                <ul className="list-disc pl-5 space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-12 px-4 py-3 bg-blue-600 text-white text-base font-bold rounded-xl"
          >
            {afterLogin ? DEMO_TERMS_AGREE : DEMO_TERMS_CLOSE}
          </button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
