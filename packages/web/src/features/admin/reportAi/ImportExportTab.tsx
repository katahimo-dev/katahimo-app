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
import { INPUT_CLASS } from '../components/FormField';

/** ファイルを base64(data URL の頭を除いたもの)にする。 */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 「取込・書き出し」: 日報キーワード表現マスター(xlsx)を選ぶと、まず確かめて(件数・誤り・知らせ)を出し、
 * 誤りが無ければ「反映する」で取り込む(キーで突き合わせて足す・書き換える。ファイルに無い行は消さない)。
 * 今の内容を同じ形の xlsx に書き出す・教育キーワードの利用状況を CSV で保存する。
 */
export function ImportExportTab({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<ReportAiImportResponse | null>(null);
  const [error, setError] = useState('');
  const [range, setRange] = useState(() => {
    const to = todayJst();
    return { from: addDaysYmd(to, -29), to };
  });
  const download = useFileDownload<'xlsx' | 'usage'>();

  const run = useMutation({
    mutationFn: ({ chosen, dryRun }: { chosen: { name: string; base64: string }; dryRun: boolean }) =>
      reportAiApi.importXlsx({ fileBase64: chosen.base64, fileName: chosen.name, dryRun }),
    onSuccess: (result) => {
      setPreview(result);
      if (result.applied) {
        showToast('取り込みました');
        onImported();
      }
    },
    onError: (e) => setError(userMessageOf(e)),
  });

  const choose = async (selected: File | undefined) => {
    setPreview(null);
    setError('');
    if (!selected) return;
    if (selected.size > REPORT_AI_IMPORT_MAX_BYTES) {
      setError('ファイルが大きすぎます(2MBまで)');
      return;
    }
    const chosen = { name: selected.name, base64: await readAsBase64(selected) };
    setFile(chosen);
    run.mutate({ chosen, dryRun: true });
  };

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="reportAiImportHeading"
        className="bg-white p-4 rounded-2xl border border-gray-200 space-y-3"
      >
        <h3 id="reportAiImportHeading" className="font-bold text-gray-800 text-base">
          日報キーワード表現マスター(Excel)を取り込む
        </h3>
        <p className="text-sm text-gray-600">
          シートの見出しで表の種類を見分けます(マスター表・年齢帯定義・教育思考レベル定義・PSI指標定義・温かみ表現・
          見ていた人スタンス)。キーワードは
          ID、年齢帯は年齢帯の名前、表現は区分と表現で同じ行を探し、足す・書き換えます
          (ファイルに無い行は消しません)。
        </p>
        <label htmlFor="reportAiImportFile" className="block text-sm font-bold text-gray-700">
          ファイル(.xlsx)
        </label>
        <input
          id="reportAiImportFile"
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => void choose(e.target.files?.[0])}
          className="block w-full text-base"
        />
        {error ? (
          <p role="alert" className="text-base text-red-600 bg-red-50 rounded-xl p-3">
            {error}
          </p>
        ) : null}
        {preview ? <ImportPreview result={preview} /> : null}
        {preview && !preview.applied ? (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => file && run.mutate({ chosen: file, dryRun: false })}
              disabled={preview.errors.length > 0 || run.isPending || !file}
              className="flex-1 min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl disabled:opacity-50"
            >
              {run.isPending ? '取り込み中...' : '反映する'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setFile(null);
                if (fileRef.current) fileRef.current.value = '';
              }}
              className="min-h-12 px-4 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
            >
              やめる
            </button>
          </div>
        ) : null}
      </section>

      <section
        aria-labelledby="reportAiExportHeading"
        className="bg-white p-4 rounded-2xl border border-gray-200 space-y-3"
      >
        <h3 id="reportAiExportHeading" className="font-bold text-gray-800 text-base">
          書き出す
        </h3>
        <button
          type="button"
          onClick={() =>
            void download.run('xlsx', reportAiApi.downloadXlsx, '日報キーワード表現マスターを保存しました')
          }
          disabled={download.busy !== null}
          className="w-full min-h-12 py-3 bg-green-600 text-white text-base font-bold rounded-xl disabled:opacity-50"
        >
          ⬇ 今の内容をExcelで保存(そのまま取り込めます)
        </button>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm font-bold text-gray-700">
            期間の始め
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className={INPUT_CLASS}
            />
          </label>
          <label className="text-sm font-bold text-gray-700">
            期間の終わり
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className={INPUT_CLASS}
            />
          </label>
        </div>
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
          className="w-full min-h-12 py-3 bg-gray-700 text-white text-base font-bold rounded-xl disabled:opacity-50"
        >
          ⬇ 教育キーワードの利用状況(CSV)
        </button>
      </section>
    </div>
  );
}

function ImportPreview({ result }: { result: ReportAiImportResponse }) {
  return (
    <div className="space-y-3" id="reportAiImportPreview">
      <p className="text-base font-bold text-gray-800">
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
          className="text-sm text-red-700 bg-red-50 rounded-xl p-3 space-y-1"
        >
          {result.errors.map((issue, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同じシート・行の誤りが並ぶことがあるため並び順で区別する
            <li key={i}>{`${issue.sheet}${issue.row ? ` ${issue.row}行目` : ''}: ${issue.message}`}</li>
          ))}
        </ul>
      ) : null}
      {result.warnings.length > 0 ? (
        <ul aria-label="取込の知らせ" className="text-sm text-amber-900 bg-amber-50 rounded-xl p-3 space-y-1">
          {result.warnings.map((issue, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同じシートの知らせが並ぶことがあるため並び順で区別する
            <li key={i}>{`${issue.sheet}${issue.row ? ` ${issue.row}行目` : ''}: ${issue.message}`}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
