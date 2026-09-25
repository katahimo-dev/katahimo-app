import { useElapsedSeconds } from '../hooks/useElapsedSeconds';
import type { VisitCompleteState } from '../hooks/useReportController';
import { cx } from './cx';

/** 生成・保存の目安の時間(この秒数でボタンの背景のバーが端まで届く) */
const PROGRESS_REFERENCE_SECONDS = 90;

const GENERATE_BTN_BASE =
  'w-full min-h-12 py-3 text-base font-bold rounded-xl shadow-lg transform transition-transform active:scale-95 flex items-center justify-center gap-2';
const SAVE_BTN_BASE =
  'w-full min-h-12 py-3 text-base font-bold rounded-xl shadow-lg transform transition-transform active:scale-95';
const VISIT_COMPLETE_BTN_BASE = 'w-full min-h-12 py-3 px-4 text-base font-bold rounded-xl transition-colors';

/** 待っているあいだのボタンの背景(経過に合わせて左から暗くなるバー。GAS版 startLoadingUI) */
function progressStyle(elapsed: number) {
  const pct = Math.min((elapsed / PROGRESS_REFERENCE_SECONDS) * 100, 100);
  return { backgroundImage: `linear-gradient(90deg, rgba(0,0,0,0.15) ${pct}%, transparent ${pct}%)` };
}

/** スピナー +「…（N秒）」+ 目安の一言(GAS版 startLoadingUI の中身) */
function LoadingLabel({ label, elapsed, note }: { label: string; elapsed: number; note?: string }) {
  return (
    <>
      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full loading-spinner inline-block align-middle mr-2" />
      <span className="align-middle">
        {label}（{elapsed}秒）
      </span>
      {note ? <span className="block text-sm font-normal">{note}</span> : null}
    </>
  );
}

/**
 * 下に固定したバー(AI生成・保存)。下までスクロールしなくても押せるように本文の外に置く(GAS版 #reportModalFooter)。
 * 結果が出たあとは、AI生成は灰色の「もう一度…」、青の主ボタンは保存ボタンに移る。
 */
export function ReportFooter({
  hidden,
  generateLabel,
  hasResult,
  generatingSince,
  saveShown,
  savedAndClean,
  savingSince,
  onGenerate,
  onSave,
}: {
  hidden: boolean;
  generateLabel: string;
  hasResult: boolean;
  generatingSince: number | null;
  saveShown: boolean;
  savedAndClean: boolean;
  savingSince: number | null;
  onGenerate: () => void;
  onSave: () => void;
}) {
  const generating = generatingSince !== null;
  const saving = savingSince !== null;
  const generateElapsed = useElapsedSeconds(generatingSince);
  const saveElapsed = useElapsedSeconds(savingSince);

  // 待っているあいだは白いスピナーが見えるよう青にする
  const generateColor = hasResult && !generating ? 'bg-gray-200 text-gray-800' : 'bg-blue-600 text-white';
  const saveColor = savedAndClean && !saving ? 'bg-gray-200 text-gray-800' : 'bg-blue-600 text-white';

  return (
    <div
      id="reportModalFooter"
      className={cx(
        'border-t bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] space-y-3',
        hidden && 'hidden',
      )}
    >
      <button
        type="button"
        onClick={onGenerate}
        id="generateBtn"
        disabled={generating}
        style={generating ? progressStyle(generateElapsed) : undefined}
        className={cx(GENERATE_BTN_BASE, generateColor)}
      >
        {generating ? (
          <LoadingLabel
            label="AIが書いています…"
            elapsed={generateElapsed}
            note="1分ほどかかることがあります"
          />
        ) : (
          <span>{generateLabel}</span>
        )}
      </button>
      <div id="saveBtnContainer" className={cx(!saveShown && 'hidden')}>
        <button
          type="button"
          onClick={onSave}
          id="saveBtn"
          disabled={saving}
          style={saving ? progressStyle(saveElapsed) : undefined}
          className={cx(SAVE_BTN_BASE, saveColor)}
        >
          {saving ? (
            <LoadingLabel label="保存しています…" elapsed={saveElapsed} />
          ) : savedAndClean ? (
            '✅ 保存しました'
          ) : (
            '保存する'
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * 「✅ 訪問終わりました（事務局に知らせる）」。日報の一番最後にする作業なので本文の一番下に置く。
 * 送ったあとは二重に送らないよう、押せない灰色のボタンにする(GAS版 markVisitCompleteSent_)。
 */
export function VisitCompleteButton({
  hidden,
  state,
  onClick,
}: {
  hidden: boolean;
  state: VisitCompleteState;
  onClick: () => void;
}) {
  const sent = state.status === 'sent';
  return (
    <div id="visitCompleteContainer" className={cx('pt-2', hidden && 'hidden')}>
      <button
        type="button"
        onClick={onClick}
        id="visitCompleteBtn"
        disabled={state.status !== 'idle'}
        className={cx(
          VISIT_COMPLETE_BTN_BASE,
          sent ? 'bg-gray-200 text-gray-600' : 'bg-green-600 text-white',
        )}
      >
        {state.status === 'sending'
          ? '送っています…'
          : sent
            ? `✅ 送りました ${state.at}`
            : '✅ 訪問終わりました（事務局に知らせる）'}
      </button>
    </div>
  );
}
