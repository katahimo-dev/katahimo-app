import { STAFF_IMPORT_MAX_BYTES, STAFF_SHEET_COLUMNS, type StaffImportResponse } from '@katahimo/shared';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { adminStaffApi } from '../../../api/admin';
import { userMessageOf } from '../../../api/client';
import { showToast } from '../../../ui/toast';
import { CARD_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../components/FormField';
import { readAsBase64 } from '../components/readAsBase64';

type ChosenFile = { name: string; base64: string };

/**
 * スタッフの Excel 取込(先に確かめて、誤りが無ければ「反映する」)。書き出した「スタッフ一覧.xlsx」を直して取り込む想定
 * (CSV は Excel で開くと文字化けしやすいため xlsx)。ID(無ければメールアドレス)で同じスタッフを探して足す・書き換え、
 * ファイルに無いスタッフは変えない。パスワードは扱わない。
 */
export function StaffImportPanel({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [preview, setPreview] = useState<StaffImportResponse | null>(null);
  const [error, setError] = useState('');

  /** 選び直したら前のファイルの結果を捨てるための番号(古い応答で新しいファイルの結果を上書きしない)。 */
  const seq = useRef(0);

  const run = useMutation({
    mutationFn: ({
      chosen,
      dryRun,
      planDigest,
    }: {
      chosen: ChosenFile;
      dryRun: boolean;
      planDigest?: string;
    }) =>
      adminStaffApi.importXlsx({
        fileBase64: chosen.base64,
        fileName: chosen.name,
        dryRun,
        ...(planDigest ? { planDigest } : {}),
      }),
  });

  const send = (chosen: ChosenFile, dryRun: boolean, planDigest?: string) => {
    const mine = ++seq.current;
    setError('');
    run.mutate(
      { chosen, dryRun, ...(planDigest ? { planDigest } : {}) },
      {
        onSuccess: (result) => {
          if (mine !== seq.current) return;
          setPreview(result);
          if (result.applied) {
            showToast(`取り込みました(追加 ${result.counts.created}人・変更 ${result.counts.updated}人)`);
            onImported();
          }
        },
        onError: (e) => {
          if (mine !== seq.current) return;
          setError(userMessageOf(e));
          if (!dryRun) {
            // 反映できなかった(確かめた後に他の人が変えた等)ときは、確かめ直してもらう(同じファイルを選び直せるように空にする)
            setPreview(null);
            setFile(null);
            if (fileRef.current) fileRef.current.value = '';
          }
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
    if (selected.size > STAFF_IMPORT_MAX_BYTES) {
      setError('ファイルが大きすぎます(2MBまで)');
      return;
    }
    let chosen: ChosenFile;
    try {
      chosen = { name: selected.name, base64: await readAsBase64(selected) };
    } catch {
      setError('ファイルを読めませんでした。もう一度選んでください');
      return;
    }
    setFile(chosen);
    send(chosen, true);
  };

  const nothingToApply = preview !== null && preview.counts.created + preview.counts.updated === 0;

  return (
    <section aria-labelledby="staffImportHeading" className={`${CARD_CLASS} space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <h3 id="staffImportHeading" className="text-sm font-bold text-gray-800">
          Excel から取り込む
        </h3>
        <button type="button" onClick={onClose} aria-label="取込を閉じる" className="text-gray-500 px-2">
          ✕
        </button>
      </div>
      <p className="text-xs text-gray-600">
        「⬇ Excel」で保存したファイルを直して取り込みます。列:{' '}
        {STAFF_SHEET_COLUMNS.map((c) => c.label).join('・')}
        (氏名・メールアドレスは必須)。ID(空欄ならメールアドレス)で同じスタッフを探して足す・書き換えます。空欄のセルは値を消し、
        無い列は今のまま。ファイルに無いスタッフは変えません。パスワードは扱いません。
      </p>
      <input
        ref={fileRef}
        type="file"
        aria-label="スタッフのExcelファイル(.xlsx)"
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
      {preview ? <StaffImportPreview result={preview} /> : null}
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
            onClick={() => file && send(file, false, preview.planDigest)}
            disabled={preview.errors.length > 0 || nothingToApply || run.isPending || !file}
            className={PRIMARY_BUTTON}
          >
            {run.isPending ? '取り込み中...' : '反映する'}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function StaffImportPreview({ result }: { result: StaffImportResponse }) {
  const { counts } = result;
  return (
    <div className="space-y-2" id="staffImportPreview">
      <p className="text-sm font-bold text-gray-800">
        {result.applied
          ? '取り込みました'
          : result.errors.length > 0
            ? '誤りがあるため取り込めません'
            : counts.created + counts.updated === 0
              ? '変わるところはありません'
              : '取り込む内容'}
        <span className="ml-2 text-xs font-normal text-gray-600">
          {`${counts.rows}行: 追加 ${counts.created}・変更 ${counts.updated}・同じ ${counts.unchanged}`}
        </span>
      </p>
      {result.errors.length > 0 ? <IssueList label="取込の誤り" tone="error" issues={result.errors} /> : null}
      {result.warnings.length > 0 ? (
        <IssueList label="取込の知らせ" tone="warning" issues={result.warnings} />
      ) : null}
      {result.changes.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-gray-200" aria-label="取り込む変更">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-2 py-1 font-bold">行</th>
                <th className="px-2 py-1 font-bold">区分</th>
                <th className="px-2 py-1 font-bold">氏名</th>
                <th className="px-2 py-1 font-bold">メール</th>
                <th className="px-2 py-1 font-bold">変わる列</th>
              </tr>
            </thead>
            <tbody>
              {result.changes.map((c) => (
                <tr key={c.row} className="border-t">
                  <td className="px-2 py-1 text-gray-600">{c.row}</td>
                  <td className="px-2 py-1">
                    <span
                      className={`px-1.5 rounded font-bold ${
                        c.kind === 'create' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {c.kind === 'create' ? '追加' : '変更'}
                    </span>
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">{c.name}</td>
                  <td className="px-2 py-1 break-all">{c.email}</td>
                  <td className="px-2 py-1 text-gray-700">{c.fields.join('・')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function IssueList({
  label,
  tone,
  issues,
}: {
  label: string;
  tone: 'error' | 'warning';
  issues: StaffImportResponse['errors'];
}) {
  return (
    <ul
      role={tone === 'error' ? 'alert' : undefined}
      aria-label={label}
      className={`text-xs rounded-lg p-2 space-y-0.5 ${
        tone === 'error' ? 'text-red-700 bg-red-50' : 'text-amber-900 bg-amber-50'
      }`}
    >
      {issues.map((issue, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同じ行の誤りが並ぶことがあるため並び順で区別する
        <li key={i}>{`${issue.row ? `${issue.row}行目: ` : ''}${issue.message}`}</li>
      ))}
    </ul>
  );
}
