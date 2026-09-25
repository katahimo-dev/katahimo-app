import type { AttendanceDay } from '@katahimo/shared';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { attendanceApi } from '../../../api/attendance';
import { confirmNative } from '../../../ui/confirm';
import { Modal, ModalHeader } from '../../../ui/modal';
import { showErrorToast, showToast } from '../../../ui/toast';
import { isSlotFilled, type SlotDef, type SlotValues, slotPatch, toDayRecord } from '../model/dayRecord';
import { savedMessage } from '../model/saveMessage';
import { LoadingBlock } from './LoadingBlock';

/**
 * 予定(訪問・事務作業)1つの修正ダイアログ(GAS版 #pastScheduleSlotModal / openPastScheduleSlotModal)。
 *
 * その日の出勤簿を読み込み終わるまでは、週間予定などで分かっている名前・時刻を入力できない形で先に出し
 * 「準備しています…」を添える(分かっていなければ「読み込んでいます…」)。
 */
export function SlotModal({
  def,
  day,
  prefill,
  staffId,
  onClose,
  onSaved,
}: {
  def: SlotDef;
  /** その日の出勤簿(読み込み中は undefined) */
  day: AttendanceDay | undefined;
  /** 読み込み前に先に出す値 */
  prefill: SlotValues | null;
  staffId: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Modal
      transition="none"
      onClose={onClose}
      open
      labelledBy="pastScheduleSlotModalTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[120] flex items-center justify-center p-4"
    >
      <div className="bg-white w-full max-w-sm rounded-2xl border border-gray-200 flex flex-col max-h-[90vh]">
        <ModalHeader title={def.label} titleId="pastScheduleSlotModalTitle" onClose={onClose} />
        {day ? (
          <SlotForm
            key={`${day.businessDate}-${def.key}`}
            def={def}
            day={day}
            staffId={staffId}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : (
          <>
            <div className="p-4 space-y-2 overflow-y-auto">
              {prefill ? (
                <SlotFields def={def} values={prefill} disabled pending />
              ) : (
                <LoadingBlock padding="py-6" />
              )}
            </div>
            <SlotFooter onClose={onClose} />
          </>
        )}
      </div>
    </Modal>
  );
}

function SlotForm({
  def,
  day,
  staffId,
  onClose,
  onSaved,
}: {
  def: SlotDef;
  day: AttendanceDay;
  staffId: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = toDayRecord(day.rowData).slots[def.key];
  const [values, setValues] = useState<SlotValues>(initial);

  const save = useMutation({
    mutationFn: (next: SlotValues) =>
      attendanceApi.updateDay({ date: day.businessDate, staffId, rowData: slotPatch(def.key, next) }),
    onSuccess: (res) => {
      showToast(savedMessage(res));
      onSaved();
    },
    onError: (e) => showErrorToast(e),
  });

  const onDelete = () => {
    if (!confirmNative('この予定の内容を消します。よろしいですか？')) return;
    save.mutate({ name: '', start: '', end: '' });
  };

  return (
    <>
      <div className="p-4 space-y-2 overflow-y-auto">
        <SlotFields
          def={def}
          values={values}
          disabled={!day.editable}
          onChange={(field, value) => setValues((v) => ({ ...v, [field]: value }))}
        />
      </div>
      <SlotFooter
        onClose={onClose}
        onDelete={day.editable && isSlotFilled(initial) ? onDelete : undefined}
        onSave={day.editable ? () => save.mutate(values) : undefined}
        busy={save.isPending}
        deleting={save.isPending && save.variables?.start === '' && save.variables.end === ''}
      />
    </>
  );
}

function SlotFields({
  def,
  values,
  disabled,
  pending = false,
  onChange,
}: {
  def: SlotDef;
  values: SlotValues;
  disabled: boolean;
  /** 読み込み前の仮の表示(灰色の入力欄 +「準備しています…」) */
  pending?: boolean;
  onChange?: (field: keyof SlotValues, value: string) => void;
}) {
  const id = useId();
  const inputCls = `w-full p-3 border border-gray-300 rounded-xl text-base${pending ? ' bg-gray-50' : ''}`;
  return (
    <>
      <div>
        <label htmlFor={`${id}-name`} className="block text-base font-bold text-gray-700 mb-0.5">
          {def.nameLabel}
        </label>
        <input
          id={`${id}-name`}
          type="text"
          value={values.name}
          disabled={disabled}
          onChange={(e) => onChange?.('name', e.target.value)}
          className={inputCls}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${id}-start`} className="block text-base font-bold text-gray-700 mb-0.5">
            始め
          </label>
          <input
            id={`${id}-start`}
            type="time"
            value={values.start}
            disabled={disabled}
            onChange={(e) => onChange?.('start', e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor={`${id}-end`} className="block text-base font-bold text-gray-700 mb-0.5">
            終わり
          </label>
          <input
            id={`${id}-end`}
            type="time"
            value={values.end}
            disabled={disabled}
            onChange={(e) => onChange?.('end', e.target.value)}
            className={inputCls}
          />
        </div>
      </div>
      {pending ? (
        <div className="flex items-center gap-1.5 text-sm text-gray-600 pt-1">
          <div className="w-3 h-3 rounded-full border-2 border-gray-200 loading-spinner" />
          準備しています…
        </div>
      ) : null}
    </>
  );
}

function SlotFooter({
  onClose,
  onDelete,
  onSave,
  busy = false,
  deleting = false,
}: {
  onClose: () => void;
  onDelete?: () => void;
  onSave?: () => void;
  busy?: boolean;
  deleting?: boolean;
}) {
  return (
    <div className="p-4 border-t bg-gray-50 rounded-b-2xl flex gap-3">
      {onDelete ? (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="min-h-12 py-3 px-3 bg-red-600 text-white text-sm font-bold rounded-xl"
        >
          削除
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="flex-1 min-h-12 py-3 bg-gray-200 text-gray-800 text-sm font-bold rounded-xl"
      >
        キャンセル
      </button>
      {onSave ? (
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="flex-1 min-h-12 py-3 bg-blue-600 text-white text-sm font-bold rounded-xl"
        >
          {busy && !deleting ? '保存中...' : '保存する'}
        </button>
      ) : null}
    </div>
  );
}
