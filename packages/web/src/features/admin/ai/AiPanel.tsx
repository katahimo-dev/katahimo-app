import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { aiPromptsApi, reportAiApi } from '../../../api/admin';
import { adminQueryKeys } from '../adminQueryKeys';
import { SectionTabPanel, SectionTabs } from '../components/SectionTabs';
import { PromptsPanel } from '../prompts/PromptsPanel';
import { ReportAiPanel } from '../reportAi/ReportAiPanel';
import { AiConnectionPanel } from '../settings/AiConnectionPanel';
import { useConfirmLeave } from '../unsavedChanges';
import { type MasterUsage, summarizeAiUsage } from './aiUsageModel';

const TABS = [
  { key: 'prompts', label: '① プロンプト(指示文)' },
  { key: 'words', label: '② 日報の言葉の表' },
  { key: 'connection', label: 'APIキー・モデル' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/**
 * 管理タブ「🤖 AI」。AI に関わる設定を1か所にまとめる: プロンプト(日報・事故報告の指示文の型。GAS版「ＡＩプロンプト」シート)、
 * 日報の言葉の表(日報AIの調整。お客様の日報キーワード表現マスター)、Gemini の APIキー・モデル(GAS版は設定ダイアログ)。
 * プロンプトと表は「どちらか」ではなく、プロンプトの差し込みに表から選んだ言葉が入ることを上の「しくみ」で見せる。
 */
export function AiPanel() {
  const confirmLeave = useConfirmLeave();
  const [tab, setTab] = useState<Tab>('prompts');
  const select = async (next: Tab) => {
    if (!(await confirmLeave())) return false;
    setTab(next);
    return true;
  };
  return (
    <section aria-labelledby="adminAiHeading" className="space-y-3">
      <h2 id="adminAiHeading" className="sr-only">
        AI
      </h2>
      <AiUsageOverview onOpen={(next) => void select(next)} />
      <SectionTabs
        tabs={TABS}
        selected={tab}
        onSelect={select}
        label="AIの設定"
        idPrefix="adminAi"
        variant="pill"
      />
      <SectionTabPanel idPrefix="adminAi" tabKey={tab}>
        {tab === 'prompts' ? <PromptsPanel /> : null}
        {tab === 'words' ? <ReportAiPanel /> : null}
        {tab === 'connection' ? <AiConnectionPanel /> : null}
      </SectionTabPanel>
    </section>
  );
}

/** 保育日報の AI への指示がどう組み立てられるか(プロンプト + 表から選んだ言葉)と、表ごとの行数・使われているか。 */
function AiUsageOverview({ onOpen }: { onOpen: (tab: Tab) => void }) {
  const prompts = useQuery({
    queryKey: adminQueryKeys.prompts,
    queryFn: ({ signal }) => aiPromptsApi.list(signal),
  });
  const masters = useQuery({
    queryKey: adminQueryKeys.reportAi,
    queryFn: ({ signal }) => reportAiApi.masters(signal),
    staleTime: 0,
  });
  const summary = prompts.data && masters.data ? summarizeAiUsage(prompts.data.prompts, masters.data) : null;

  return (
    <section
      aria-labelledby="aiUsageHeading"
      className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 space-y-2 text-sm text-gray-800"
    >
      <h3 id="aiUsageHeading" className="font-bold">
        保育日報のAIのしくみ
      </h3>
      <p className="text-xs text-gray-700 leading-relaxed">
        <button type="button" onClick={() => onOpen('prompts')} className="font-bold text-blue-700 underline">
          ① プロンプト
        </button>
        を指示文の型にして、その中の差し込み({'{keywordTable}'} など)に、お子様の年齢・ご家庭の教育思考★・PSI
        で
        <button type="button" onClick={() => onOpen('words')} className="font-bold text-blue-700 underline">
          ② 日報の言葉の表
        </button>
        から選んだ言葉を入れて AI に送ります。
        <strong>どちらかを選ぶのではなく、いつも両方を使います。</strong>
        表が空の差し込みは行ごと消え、プロンプトだけで作ります(GAS版と同じ)。事故報告は表を使いません。
      </p>
      {summary ? (
        <>
          <ul aria-label="日報の言葉の表の使われ方" className="flex flex-wrap gap-1">
            {summary.masters.map((m) => (
              <MasterChip key={m.table} usage={m} />
            ))}
          </ul>
          {summary.unusedMasters.length > 0 ? (
            <p role="alert" className="text-xs font-bold text-amber-900 bg-amber-100 rounded-lg px-2 py-1">
              {`保育日報のプロンプトに差し込みが無いため、${summary.unusedMasters
                .map((m) => m.label)
                .join(
                  '・',
                )}の表は AI に渡っていません。プロンプトを既定に戻すか、差し込みを書き足してください。`}
            </p>
          ) : null}
          {summary.dailyPromptCustomized ? (
            <p className="text-xs text-gray-600">保育日報のプロンプトは既定から変更されています。</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function MasterChip({ usage }: { usage: MasterUsage }) {
  const [tone, state] = !usage.inPrompt
    ? usage.rows > 0
      ? ['bg-amber-100 text-amber-900', '使われていません']
      : ['bg-gray-100 text-gray-600', '差し込みなし']
    : usage.rows > 0
      ? ['bg-green-100 text-green-800', '差し込み中']
      : ['bg-white text-gray-600 border border-gray-200', '未登録'];
  return (
    <li className={`px-2 py-0.5 rounded-full text-xs font-bold ${tone}`}>
      {`${usage.label} ${usage.rows}件・${state}`}
    </li>
  );
}
