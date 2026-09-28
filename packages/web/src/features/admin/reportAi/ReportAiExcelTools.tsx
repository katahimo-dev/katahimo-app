import {
  REPORT_AI_IMPORT_MAX_BYTES,
  REPORT_AI_MASTER_KIND_LABELS,
  REPORT_AI_MASTER_KINDS,
  type ReportAiImportResponse,
} from '@katahimo/shared';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { reportAiApi } from '../../../api/admin';
import { userMessageOf } from '../../../api/client';
import { addDaysYmd, todayJst } from '../../../lib/date';
import { useFileDownload } from '../../../lib/useFileDownload';
import { showToast } from '../../../ui/toast';
import { CARD_CLASS, INPUT_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../components/FormField';
import { readAsBase64 } from '../components/readAsBase64';

/**
 * 日報の言葉の表の上に置く Excel の操作。「⬆ Excel取込」: 日報キーワード表現マスター(xlsx)を選ぶと、まず確かめて(件数・誤り・知らせ)
 * を出し、誤りが無ければ「反映する」で取り込む(キーで突き合わせて足す・書き換える。ファイルに無い行は消さない)。
 * 「⬇ Excel」: 今の内容を同じ形の xlsx に書き出す(そのまま取り込める)。「📊 利用状況」: 教育キーワードの利用状況を CSV で保存する。
 */
export function ReportAiExcelTools({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState<'import' | 'usage' | null>(null);
  const download = useFileDownload<'xlsx' | 'usage'>();
  const toggle = (next: 'import' | 'usage') => setOpen((cur) => (cur === next ? null : next));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => toggle('import')}
          aria-expanded={open === 'import'}
          className={SECONDARY_BUTTON}
        >
          ⬆ Excel取込
        </button>
        <button
          type="button"
          onClick={() =>
            void download.run('xlsx', reportAiApi.downloadXlsx, '日報キーワード表現マスターを保存しました')
          }
          disabled={download.busy !== null}
          className={SECONDARY_BUTTON}
        >
          ⬇ Excel
        </button>
        <button
          type="button"
          onClick={() => toggle('usage')}
          aria-expanded={open === 'usage'}
          className={SECONDARY_BUTTON}
        >
          📊 利用状況
        </button>
        <span className="text-xs text-gray-600">全部の表をまとめて Excel で読み書きできます</span>
      </div>
      {open === 'import' ? <ImportSection onImported={onImported} onClose={() => setOpen(null)} /> : null}
      {open === 'usage' ? <UsageSection download={download} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function PanelHeader({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 id={id} className="font-bold text-gray-800 text-sm">
        {title}
      </h3>
      <button type="button" onClick={onClose} aria-label={`${title}を閉じる`} className="text-gray-500 px-2">
        ✕
      </button>
    </div>
  );
}

function ImportSection({ onImported, onClose }: { onImported: () => void; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<ReportAiImportResponse | null>(null);
  const [error, setError] = useState('');
  /** 選び直したら前のファイルの結果を捨てるための番号。 */
  const seq = useRef(0);

  const run = useMutation({
    mutationFn: ({ chosen, dryRun }: { chosen: { name: string; base64: string }; dryRun: boolean }) =>
      reportAiApi.importXlsx({ fileBase64: chosen.base64, fileName: chosen.name, dryRun }),
  });

  const send = (chosen: { name: string; base64: string }, dryRun: boolean) => {
    const mine = ++seq.current;
    setError('');
    run.mutate(
      { chosen, dryRun },
      {
        onSuccess: (result) => {
          if (mine !== seq.current) return;
          setPreview(result);
          if (result.applied) {
            showToast('取り込みました');
            onImported();
          }
        },
        onError: (e) => {
          if (mine === seq.current) setError(userMessageOf(e));
        },
      },
    );
  };

  const choose = async (selected: File | undefined) => {
    seq.current++;
    setPreview(null);
    setError('');
    setFile(null);
    if (!selected) return;
    if (selected.size > REPORT_AI_IMPORT_MAX_BYTES) {
      setError('ファイルが大きすぎます(2MBまで)');
      return;
    }
    try {
      const chosen = { name: selected.name, base64: await readAsBase64(selected) };
      setFile(chosen);
      send(chosen, true);
    } catch {
      setError('ファイルを読めませんでした。もう一度選んでください');
    }
  };

  return (
    <section aria-labelledby="reportAiImportHeading" className={`${CARD_CLASS} space-y-2`}>
      <PanelHeader
        id="reportAiImportHeading"
        title="日報キーワード表現マスター(Excel)を取り込む"
        onClose={onClose}
      />
      <p className="text-xs text-gray-600">
        「⬇
        Excel」で保存したファイルか、お客様の日報キーワード表現マスターを選びます。シートの見出しで表の種類を見分け
        (マスター表・年齢帯定義・教育思考レベル定義・PSI指標定義・温かみ表現・見ていた人スタンス)、キーワードは
        ID、年齢帯は
        年齢帯の名前、表現は区分と表現で同じ行を探して足す・書き換えます(ファイルに無い行は消しません)。
      </p>
      <input
        id="reportAiImportFile"
        ref={fileRef}
        type="file"
        aria-label="日報キーワード表現マスターのファイル(.xlsx)"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => void choose(e.target.files?.[0])}
        className="block w-full text-sm"
      />
      {run.isPending ? <p className="text-xs text-gray-600">確かめています...</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-2">
          {error}
        </p>
      ) : null}
      {preview ? <ImportPreview result={preview} /> : null}
      {preview && !preview.applied ? (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              seq.current++;
              setPreview(null);
              setFile(null);
              if (fileRef.current) fileRef.current.value = '';
            }}
            className={SECONDARY_BUTTON}
          >
            やめる
          </button>
          <button
            type="button"
            onClick={() => file && send(file, false)}
            disabled={preview.errors.length > 0 || run.isPending || !file}
            className={PRIMARY_BUTTON}
          >
            {run.isPending ? '取り込み中...' : '反映する'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function UsageSection({
  download,
  onClose,
}: {
  download: ReturnType<typeof useFileDownload<'xlsx' | 'usage'>>;
  onClose: () => void;
}) {
  const [range, setRange] = useState(() => {
    const to = todayJst();
    return { from: addDaysYmd(to, -29), to };
  });
  return (
    <section aria-labelledby="reportAiUsageHeading" className={`${CARD_CLASS} space-y-2`}>
      <PanelHeader id="reportAiUsageHeading" title="教育キーワードの利用状況(CSV)" onClose={onClose} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-bold text-gray-700">
          期間の始め
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="text-xs font-bold text-gray-700">
          期間の終わり
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            className={INPUT_CLASS}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            void download.run(
              'usage',
              () => reportAiApi.downloadUsageCsv(range),
              '教育キーワードの利用状況を保存しました',
            )
          }
          disabled={download.busy !== null}
          className={PRIMARY_BUTTON}
        >
          ⬇ CSVで保存
        </button>
      </div>
    </section>
  );
}

function ImportPreview({ result }: { result: ReportAiImportResponse }) {
  return (
    <div className="space-y-3" id="reportAiImportPreview">
      <p className="text-sm font-bold text-gray-800">
        {result.applied
          ? '取り込みました'
          : result.errors.length > 0
            ? '誤りがあるため取り込めません'
            : '取り込む内容'}
      </p>
      <table className="w-full text-sm border border-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-2 text-left">表</th>
            <th className="p-2 text-right">行</th>
            <th className="p-2 text-right">追加</th>
            <th className="p-2 text-right">変更</th>
            <th className="p-2 text-right">同じ</th>
          </tr>
        </thead>
        <tbody>
          {REPORT_AI_MASTER_KINDS.map((kind) => {
            const c = result.counts[kind];
            return (
              <tr key={kind} className="border-t">
                <td className="p-2">{REPORT_AI_MASTER_KIND_LABELS[kind]}</td>
                <td className="p-2 text-right">{c.rows}</td>
                <td className="p-2 text-right">{c.created}</td>
                <td className="p-2 text-right">{c.updated}</td>
                <td className="p-2 text-right">{c.unchanged}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {result.errors.length > 0 ? (
        <ul
          role="alert"
          aria-label="取込の誤り"
          className="text-sm text-red-700 bg-red-50 rounded-lg p-3 space-y-1"
        >
          {result.errors.map((issue, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同じシート・行の誤りが並ぶことがあるため並び順で区別する
            <li key={i}>{`${issue.sheet}${issue.row ? ` ${issue.row}行目` : ''}: ${issue.message}`}</li>
          ))}
        </ul>
      ) : null}
      {result.warnings.length > 0 ? (
        <ul aria-label="取込の知らせ" className="text-sm text-amber-900 bg-amber-50 rounded-lg p-3 space-y-1">
          {result.warnings.map((issue, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同じシートの知らせが並ぶことがあるため並び順で区別する
            <li key={i}>{`${issue.sheet}${issue.row ? ` ${issue.row}行目` : ''}: ${issue.message}`}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
