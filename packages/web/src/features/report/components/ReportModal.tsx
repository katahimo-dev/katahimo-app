import { useFadeTransition } from '../../../ui/modal';
import { useReportController } from '../hooks/useReportController';
import { useVoiceInput } from '../hooks/useVoiceInput';
import {
  generateButtonLabel,
  hasGeneratedResult,
  isSaveButtonShown,
  isSavedAndClean,
} from '../model/reportForm';
import type { ReportSession } from '../types';
import { AccidentDraft } from './AccidentDraft';
import { AssessmentSection } from './AssessmentSection';
import { cx } from './cx';
import { DailyResult } from './DailyResult';
import { DateTimeSection } from './DateTimeSection';
import { FamilySelector } from './FamilySelector';
import { HintModal } from './HintModal';
import { MemoSection } from './MemoSection';
import { ModeTabs } from './ModeTabs';
import { ReceiptSection } from './ReceiptSection';
import { ReportFooter, VisitCompleteButton } from './ReportFooter';
import { ReportHeader } from './ReportHeader';

const STANDALONE_TITLE = 'お客様の指定なし（新しいお客様）';
const STANDALONE_SUBTITLE = 'お仕事で使った領収書を送ります';

/**
 * 日報・事故報告・領収書のダイアログ(下から出るシート。GAS版 #reportModal)。
 * 各欄はGAS版と同じ並び・同じクラスで置き、出し分けは GAS版と同じく hidden クラスの付け外しで行う
 * (親の space-y-4 の間隔が GAS版と同じになるように)。
 */
export function ReportModal({
  session,
  open,
  onClose,
}: {
  session: ReportSession | null;
  open: boolean;
  onClose: () => void;
}) {
  const c = useReportController(session);
  const { mounted, shown } = useFadeTransition(open);
  const voice = useVoiceInput(c.actions.appendMemo);

  const f = c.form;
  const standalone = session?.kind === 'standalone';
  const isDaily = f.mode === 'daily';
  const placeholder = (isDaily ? c.uiConfig?.dailyPlaceholder : c.uiConfig?.accidentPlaceholder) ?? '';

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modalCustomerName"
        id="reportModal"
        className={cx(
          'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center transition-opacity',
          !mounted && 'hidden',
          !shown && 'opacity-0',
        )}
      >
        <div
          className={cx(
            'bg-white w-full max-w-md h-[90vh] sm:h-auto sm:max-h-[85vh] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col transform transition-transform',
            !shown && 'translate-y-full',
          )}
        >
          <ReportHeader
            title={standalone ? STANDALONE_TITLE : (c.customer?.name ?? '')}
            subtitle={standalone ? STANDALONE_SUBTITLE : (c.customer?.address ?? '')}
            showUnregisteredName={standalone}
            unregisteredName={c.unregisteredName}
            onUnregisteredNameChange={c.actions.setUnregisteredName}
            onClose={onClose}
          />

          <ModeTabs mode={f.mode} hidden={standalone} onSwitch={c.actions.switchMode} />

          <div className="p-4 pb-6 overflow-y-auto flex-grow space-y-4">
            <DateTimeSection
              form={f}
              today={c.today}
              hidden={standalone}
              onToggleEditor={c.actions.toggleDateTimeEditor}
              onChangeDate={c.actions.changeDate}
              onStartChange={c.actions.setStart}
              onEndChange={c.actions.setEnd}
            />

            <FamilySelector
              hidden={standalone || isDaily}
              family={c.customer?.family ?? []}
              value={f.familyIndex}
              today={new Date()}
              onSelect={c.actions.selectFamily}
            />

            <MemoSection
              hidden={standalone}
              mode={f.mode}
              memo={f.memo}
              placeholder={placeholder}
              accidentType={f.accidentType}
              listening={voice.listening}
              warnings={f.warnings}
              warningsRef={c.scrollRefs.warnings}
              onMemoChange={c.actions.setMemo}
              onAccidentTypeChange={c.actions.setAccidentType}
              onOpenHint={c.openWritingHint}
              onToggleVoice={voice.toggle}
            />

            <DailyResult
              shown={!standalone && isDaily && f.dailyResultShown}
              internalText={f.internalText}
              customerText={f.customerText}
              onChange={c.actions.setDailyText}
            />

            <AccidentDraft
              shown={!standalone && !isDaily && f.accidentResultShown}
              values={f.accident}
              containerRef={c.scrollRefs.accidentResult}
              onChange={c.actions.setAccidentField}
            />

            <AssessmentSection
              hidden={standalone || !isDaily}
              ratings={f.ratings}
              assessments={c.uiConfig?.assessments}
              onRate={c.actions.setRating}
              onShowHint={c.openAssessmentHint}
            />

            <ReceiptSection
              hidden={!standalone && !isDaily}
              receipts={c.receipts}
              onSend={c.sendReceipts}
              onEdited={c.actions.markEdited}
            />

            <VisitCompleteButton hidden={standalone} state={c.visitComplete} onClick={c.sendVisitComplete} />
          </div>

          <ReportFooter
            hidden={standalone}
            generateLabel={generateButtonLabel(f)}
            hasResult={hasGeneratedResult(f)}
            generatingSince={c.generatingSince}
            saveShown={isSaveButtonShown(f)}
            savedAndClean={isSavedAndClean(f)}
            savingSince={c.savingSince}
            onGenerate={c.generate}
            onSave={c.save}
          />
        </div>
      </div>

      <HintModal
        open={c.hintOpen}
        hint={c.hint}
        assessments={c.uiConfig?.assessments}
        onClose={c.closeHint}
      />
    </>
  );
}
