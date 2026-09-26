import type { AiPromptView } from '@katahimo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { aiPromptsApi } from '../../../api/admin';
import { ApiRequestError, userMessageOf } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { useConfirmModal } from '../../../ui/confirm';
import { ErrorState, Loading } from '../../../ui/StatusViews';
import { showErrorToast, showToast } from '../../../ui/toast';
import { adminQueryKeys } from '../adminQueryKeys';
import { INPUT_CLASS } from '../components/FormField';
import { useUnsavedChangesWarning } from '../useUnsavedChangesWarning';

const KIND_LABELS: Record<AiPromptView['kind'], string> = {
  prompt: 'AIへの指示',
  placeholder: '入力欄の例・ヒント',
};

function PromptEditor({
  prompt,
  value,
  onChange,
}: {
  prompt: AiPromptView;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = `aiPrompt-${prompt.key}`;
  const edited = value !== prompt.body;
  const isDefault = value === prompt.defaultBody;
  return (
    <li className="bg-white p-4 rounded-2xl border border-gray-200 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor={id} className="font-bold text-gray-800 text-base">
          {prompt.label}
        </label>
        <span className="text-sm text-gray-600">{KIND_LABELS[prompt.kind]}</span>
        {edited ? (
          <span className="px-2 py-0.5 rounded-full text-sm font-bold bg-amber-100 text-amber-900">
            未保存
          </span>
        ) : prompt.customized ? (
          <span className="px-2 py-0.5 rounded-full text-sm font-bold bg-blue-100 text-blue-800">
            変更済み
          </span>
        ) : null}
      </div>
      <textarea
        id={id}
        rows={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLASS} font-mono text-sm leading-relaxed`}
      />
      <div className="flex justify-between items-center gap-2">
        <span className="text-sm text-gray-600">{`${value.length}文字`}</span>
        <button
          type="button"
          onClick={() => onChange(prompt.defaultBody)}
          disabled={isDefault}
          className="min-h-11 px-3 py-2 text-sm font-bold text-gray-800 bg-gray-200 rounded-xl disabled:opacity-50"
        >
          既定に戻す
        </button>
      </div>
    </li>
  );
}

/**
 * 管理画面「AIプロンプト」(GAS版「ＡＩプロンプト」シートの編集)。変えたものだけを、読んだときの版と一緒に送る
 * (その間に他の管理者が保存していればサーバーが 409 で断り、入力は残したまま知らせる)。
 */
export function PromptsPanel({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirmModal();
  const query = useQuery({
    queryKey: adminQueryKeys.prompts,
    queryFn: ({ signal }) => aiPromptsApi.list(signal),
  });
  /** 書きかけの本文(キー → 本文)。保存・読み込み直しで捨てる。 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const prompts = query.data?.prompts;
  const changed = useMemo(
    () => (prompts ?? []).filter((p) => drafts[p.key] !== undefined && drafts[p.key] !== p.body),
    [prompts, drafts],
  );
  const dirty = changed.length > 0;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useUnsavedChangesWarning(dirty);

  const save = useMutation({
    mutationFn: () =>
      aiPromptsApi.save({
        prompts: changed.map((p) => ({ key: p.key, body: drafts[p.key] ?? p.body, revision: p.revision })),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(adminQueryKeys.prompts, result);
      setDrafts({});
      showToast('AIプロンプトを保存しました');
      // 日報・事故報告の入力欄の例・ヒントも読み直す
      void queryClient.invalidateQueries({ queryKey: queryKeys.uiConfig });
      void queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogsAll });
    },
    onError: (error) => showErrorToast(error),
  });

  const reload = async () => {
    if (dirty) {
      const ok = await confirm({
        title: '保存していない変更を捨てて、最新の内容を読み込みますか？',
        confirmLabel: '捨てて読み込む',
      });
      if (!ok) return;
    }
    setDrafts({});
    save.reset();
    await queryClient.invalidateQueries({ queryKey: adminQueryKeys.prompts });
  };

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState message={userMessageOf(query.error)} />;

  const conflicted = save.error instanceof ApiRequestError && save.error.code === 'conflict';
  return (
    <section aria-labelledby="adminPromptsHeading" className="space-y-4">
      <h2 id="adminPromptsHeading" className="sr-only">
        AIプロンプト
      </h2>
      <p className="text-sm text-gray-600">
        日報・事故報告のAI生成への指示と、入力欄に出す例・ヒントです。{'{anonymizedText}'}(入力メモ)・
        {'{timeInfo}'}(時間)は消さないでください。
      </p>
      <ul className="space-y-4">
        {query.data.prompts.map((prompt) => (
          <PromptEditor
            key={prompt.key}
            prompt={prompt}
            value={drafts[prompt.key] ?? prompt.body}
            onChange={(value) => setDrafts((d) => ({ ...d, [prompt.key]: value }))}
          />
        ))}
      </ul>
      {conflicted ? (
        <p role="alert" className="text-base text-red-600 bg-red-50 rounded-xl p-3">
          {userMessageOf(save.error)}
        </p>
      ) : null}
      <div className="sticky bottom-20 flex gap-3 bg-white py-2">
        <button
          type="button"
          onClick={() => void reload()}
          className="min-h-12 px-4 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
        >
          🔄 読み込み直す
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="flex-1 min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl disabled:opacity-50"
        >
          {save.isPending ? '保存中...' : dirty ? `保存する（${changed.length}件）` : '保存する'}
        </button>
      </div>
    </section>
  );
}
