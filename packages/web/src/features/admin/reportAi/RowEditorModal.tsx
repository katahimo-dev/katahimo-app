import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { reportAiApi } from '../../../api/admin';
import { ApiRequestError, userMessageOf } from '../../../api/client';
import { useConfirmModal } from '../../../ui/confirm';
import { Modal, ModalFooter, ModalHeader } from '../../../ui/modal';
import { showErrorToast, showToast } from '../../../ui/toast';
import { FormField, fieldA11y, INPUT_CLASS } from '../components/FormField';
import {
  EDITOR_FIELDS,
  type EditorTable,
  type FormValues,
  formOf,
  LEVEL_KIND_OF,
  ROW_KIND_OF,
  rowOf,
} from './reportAiModel';

/** 編集する行(追加は row が null)。★・PSI は段階(level)を持つ。 */
export interface EditorTarget {
  table: EditorTable;
  title: string;
  row: (Record<string, unknown> & { id: string; rowVersion: number }) | null;
  level?: number;
}

/**
 * 日報AIの調整の1行の追加・編集(読んだときの版を送る。他の管理者が先に変えていれば 409 の理由を出す)。
 * 追加・編集できる表は「外す」(プロンプトに使わなくなる。取込で同じキーの行が来れば戻る)もできる。
 */
export function RowEditorModal({
  target,
  onClose,
  onSaved,
}: {
  target: EditorTarget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const confirm = useConfirmModal();
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!target) return;
    setValues(formOf(target.table, target.row));
    setErrors({});
    setFormError('');
  }, [target]);

  const save = useMutation({
    mutationFn: async ({ t, row }: { t: EditorTarget; row: Record<string, unknown> }) => {
      const body = { row, ...(t.row ? { rowVersion: t.row.rowVersion } : {}) };
      if (t.table === 'educationLevels' || t.table === 'psiLevels') {
        return reportAiApi.saveLevel(LEVEL_KIND_OF[t.table], t.level ?? 0, {
          ...body,
          row: { ...row, level: t.level },
        });
      }
      return reportAiApi.saveRow(ROW_KIND_OF[t.table], t.row?.id ?? null, body);
    },
  });
  const archive = useMutation({
    mutationFn: (t: EditorTarget) =>
      t.row && t.table !== 'educationLevels' && t.table !== 'psiLevels'
        ? reportAiApi.archiveRow(ROW_KIND_OF[t.table], t.row.id, t.row.rowVersion)
        : Promise.resolve({ ok: true as const }),
  });
  const busy = save.isPending || archive.isPending;

  if (!target) return null;
  const close = () => {
    if (!busy) onClose();
  };

  const submit = async () => {
    const built = rowOf(target.table, values);
    if (built.errors) {
      setErrors(built.errors);
      setFormError('入力を確かめてください');
      return;
    }
    setErrors({});
    setFormError('');
    try {
      await save.mutateAsync({ t: target, row: built.row });
      showToast('保存しました');
      onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrors(error.fields ?? {});
        setFormError(error.message);
      } else {
        setFormError(userMessageOf(error));
      }
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'この行を外しますか？（日報のAIが使わなくなります）',
      confirmLabel: '外す',
    });
    if (!ok) return;
    try {
      await archive.mutateAsync(target);
      showToast('外しました');
      onSaved();
      onClose();
    } catch (error) {
      showErrorToast(error);
    }
  };

  const canArchive =
    target.row !== null && target.table !== 'educationLevels' && target.table !== 'psiLevels';
  return (
    <Modal
      open
      onClose={close}
      labelledBy="reportAiEditorTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 transition-opacity"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="bg-white w-full max-w-lg max-h-[90vh] rounded-2xl shadow-2xl flex flex-col"
      >
        <ModalHeader
          title={target.title}
          titleId="reportAiEditorTitle"
          titleClassName="font-bold text-lg text-gray-800"
          onClose={close}
        />
        <div className="p-4 overflow-y-auto space-y-4">
          {EDITOR_FIELDS[target.table].map((field) => {
            const id = `reportAi-${field.key}`;
            const common = {
              id,
              value: values[field.key] ?? '',
              onChange: (e: { target: { value: string } }) =>
                setValues((v) => ({ ...v, [field.key]: e.target.value })),
              className: INPUT_CLASS,
              ...fieldA11y(id, errors[field.key]),
            };
            return (
              <FormField
                key={field.key}
                id={id}
                label={field.label}
                required={field.required ?? false}
                hint={field.hint}
                error={errors[field.key]}
              >
                {field.type === 'textarea' ? (
                  <textarea rows={3} {...common} />
                ) : field.type === 'select' ? (
                  <select {...common}>
                    {field.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    inputMode={field.type === 'number' ? 'numeric' : undefined}
                    {...common}
                  />
                )}
              </FormField>
            );
          })}
          {canArchive ? (
            <div className="border-t pt-4">
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="w-full min-h-11 py-2 text-sm font-bold text-red-600 bg-red-50 rounded-xl"
              >
                この行を外す
              </button>
            </div>
          ) : null}
        </div>
        {formError ? (
          <p role="alert" className="px-4 py-3 border-t text-base text-red-600 bg-red-50">
            {formError}
          </p>
        ) : null}
        <ModalFooter className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-12 px-5 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-12 px-5 py-3 bg-blue-600 text-white text-base font-bold rounded-xl"
          >
            {save.isPending ? '保存中...' : '保存する'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
