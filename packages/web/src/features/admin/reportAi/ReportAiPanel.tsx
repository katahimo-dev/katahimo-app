import { REPORT_LEVELS, type ReportAiMastersResponse } from '@katahimo/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { reportAiApi } from '../../../api/admin';
import { userMessageOf } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { EmptyState, ErrorState, Loading } from '../../../ui/StatusViews';
import { adminQueryKeys } from '../adminQueryKeys';
import { PRIMARY_BUTTON } from '../components/FormField';
import { SectionTabPanel, SectionTabs } from '../components/SectionTabs';
import { ImportExportTab } from './ImportExportTab';
import { type EditorTarget, RowEditorModal } from './RowEditorModal';
import { type EditorTable, type RowTable, summaryOf } from './reportAiModel';

const TABS = [
  { key: 'keywords', label: 'キーワード' },
  { key: 'ageBands', label: '年齢帯' },
  { key: 'educationLevels', label: '教育思考★' },
  { key: 'psiLevels', label: 'PSI' },
  { key: 'phrases', label: '表現' },
  { key: 'io', label: '取込・書き出し' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const TABLE_NAMES: Record<EditorTable, string> = {
  keywords: 'キーワード',
  ageBands: '年齢帯',
  phrases: '表現',
  stanceRules: '見ていた人スタンス',
  educationLevels: '教育思考★',
  psiLevels: 'PSI',
};

type Row = Record<string, unknown> & { id: string; rowVersion: number };

/**
 * 管理画面「日報AIの調整」(管理者だけ)。お客様の日報キーワード表現マスター(年齢帯 × 教育思考★ × PSI の3軸で
 * 日報のAIが使う言葉)を見て・行ごとに直し、xlsx で取り込む・書き出す。直した内容は次の AI 生成から使われる。
 */
export function ReportAiPanel() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('keywords');
  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const query = useQuery({
    queryKey: adminQueryKeys.reportAi,
    queryFn: ({ signal }) => reportAiApi.masters(signal),
    // 他の管理者の編集・取込で変わるので、開くたびに読み直す
    staleTime: 0,
  });
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.reportAi });
    void queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogsAll });
    // PSI の定義は日報の画面の評価の説明にも出る
    void queryClient.invalidateQueries({ queryKey: queryKeys.uiConfig });
  };

  return (
    <section aria-labelledby="adminReportAiHeading" className="space-y-3">
      <h2 id="adminReportAiHeading" className="sr-only">
        日報の言葉の表(日報AIの調整)
      </h2>
      <p className="text-xs text-gray-600">
        保護者に送る日報で、AI がお子様の年齢・ご家庭の教育思考★・PSI に合わせて使う言葉の表です。PSI
        は教育思考★より優先します(PSI 2 以下は教育の言葉を使わず、温かみ表現で寄り添います)。
      </p>
      <SectionTabs
        tabs={TABS}
        selected={tab}
        onSelect={setTab}
        label="日報AIの調整の表"
        idPrefix="reportAi"
        variant="pill"
      />
      <SectionTabPanel idPrefix="reportAi" tabKey={tab}>
        {tab === 'io' ? (
          <ImportExportTab onImported={reload} />
        ) : query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState message={userMessageOf(query.error)} />
        ) : (
          <MasterTab tab={tab} masters={query.data} onEdit={setEditing} />
        )}
      </SectionTabPanel>
      <RowEditorModal target={editing} onClose={() => setEditing(null)} onSaved={reload} />
    </section>
  );
}

function MasterTab({
  tab,
  masters,
  onEdit,
}: {
  tab: Exclude<Tab, 'io'>;
  masters: ReportAiMastersResponse;
  onEdit: (target: EditorTarget) => void;
}) {
  if (tab === 'educationLevels' || tab === 'psiLevels') {
    const rows = masters[tab] as unknown as (Row & { level: number })[];
    // ★は1〜5、PSI は 5〜1 の順(表と同じ)
    const levels = tab === 'psiLevels' ? [...REPORT_LEVELS].reverse() : [...REPORT_LEVELS];
    return (
      <ul
        className="divide-y divide-gray-100 bg-white rounded-lg border border-gray-200"
        aria-label={TABLE_NAMES[tab]}
      >
        {levels.map((level) => {
          const row = rows.find((r) => r.level === level) ?? null;
          const summary = row ? summaryOf(tab, row) : null;
          return (
            <MasterItem
              key={level}
              title={summary?.title ?? (tab === 'psiLevels' ? `PSI ${level}` : `★${level}`)}
              detail={summary?.detail ?? '未設定(既定の説明・数を使います)'}
              onClick={() =>
                onEdit({
                  table: tab,
                  level,
                  row,
                  title: `${TABLE_NAMES[tab]} ${tab === 'psiLevels' ? level : `★${level}`}`,
                })
              }
            />
          );
        })}
      </ul>
    );
  }
  const tables: RowTable[] = tab === 'phrases' ? ['phrases', 'stanceRules'] : [tab];
  return (
    <div className="space-y-4">
      {tables.map((table) => {
        const rows = masters[table] as unknown as Row[];
        return (
          <div key={table} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-gray-800 text-sm">{`${TABLE_NAMES[table]}(${rows.length})`}</h3>
              <button
                type="button"
                onClick={() => onEdit({ table, row: null, title: `${TABLE_NAMES[table]}を追加` })}
                className={PRIMARY_BUTTON}
              >
                ＋ 追加
              </button>
            </div>
            {rows.length === 0 ? (
              <EmptyState
                icon="🧩"
                title="まだありません"
                hint="「取込・書き出し」から日報キーワード表現マスターを取り込めます。"
              />
            ) : (
              <ul
                className="divide-y divide-gray-100 bg-white rounded-lg border border-gray-200"
                aria-label={TABLE_NAMES[table]}
              >
                {rows.map((row) => {
                  const summary = summaryOf(table, row);
                  return (
                    <MasterItem
                      key={row.id}
                      title={summary.title}
                      detail={summary.detail}
                      onClick={() => onEdit({ table, row, title: `${TABLE_NAMES[table]}を直す` })}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MasterItem({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-gray-50 active:bg-gray-100"
      >
        <span className="flex-1 min-w-0">
          <span className="block font-bold text-gray-800 text-sm break-all">{title}</span>
          <span className="block text-xs text-gray-600 break-all line-clamp-2">{detail}</span>
        </span>
        <span aria-hidden="true" className="text-gray-400 text-sm">
          ✏️
        </span>
      </button>
    </li>
  );
}
