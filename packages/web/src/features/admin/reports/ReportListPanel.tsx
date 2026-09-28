import {
  isPsiAlert,
  REPORT_KIND_LABELS,
  REPORT_KINDS,
  REPORT_LIST_DEFAULT_RANGE_DAYS,
  REPORT_LIST_MAX_RANGE_DAYS,
  type ReportCsvSheet,
  type ReportKind,
  type ReportListItem,
} from '@katahimo/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { userMessageOf } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { type ReportListFilters, reportsApi } from '../../../api/reports';
import { staffApi } from '../../../api/staff';
import { addDaysYmd, todayJst } from '../../../lib/date';
import { useFileDownload } from '../../../lib/useFileDownload';
import { EmptyState, ErrorState, Loading } from '../../../ui/StatusViews';
import { useCustomerList } from '../../customers';
import { adminQueryKeys } from '../adminQueryKeys';
import { INPUT_CLASS } from '../components/FormField';
import { useFollowDefaultRange } from '../useFollowDefaultRange';
import { ReportDetailModal } from './ReportDetailModal';
import { csvSheetsFor, DELETED_STAFF, REPORT_KIND_BADGE, UNKNOWN_CUSTOMER } from './reportFormat';

function defaultRange(today: string): { from: string; to: string } {
  return { from: addDaysYmd(today, -(REPORT_LIST_DEFAULT_RANGE_DAYS - 1)), to: today };
}

function defaultFilters(): ReportListFilters {
  return defaultRange(todayJst());
}

const CSV_LABELS: Record<ReportCsvSheet, string> = {
  daily: '⬇ 日報のCSV',
  accident: '⬇ 事故報告・ヒヤリハットのCSV',
};

function ReportItem({ report, onOpen }: { report: ReportListItem; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left bg-white p-3 rounded-2xl border border-gray-200 space-y-1 active:bg-gray-50"
      >
        <span className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-sm font-bold text-white px-2 py-0.5 rounded ${REPORT_KIND_BADGE[report.kind]}`}
          >
            {REPORT_KIND_LABELS[report.kind]}
          </span>
          <span className="text-sm font-bold text-gray-700">{report.date.replaceAll('-', '/')}</span>
          <span className="text-sm text-gray-600">{report.time}</span>
          {isPsiAlert(report.riskRating) ? (
            <span className="text-sm font-bold text-red-800 bg-red-100 px-2 py-0.5 rounded">
              {`⚠ PSI ${report.riskRating}`}
            </span>
          ) : null}
        </span>
        <span className="block font-bold text-gray-800 text-base">
          {report.customerName ?? UNKNOWN_CUSTOMER}
          <span className="ml-2 text-sm font-normal text-gray-700">{report.staffName ?? DELETED_STAFF}</span>
        </span>
        {report.excerpt ? (
          <span className="block text-sm text-gray-600 break-all">{report.excerpt}</span>
        ) : null}
      </button>
    </li>
  );
}

/**
 * 「報告一覧」(管理者・コーディネーター)。全員分の日報・事故報告・ヒヤリハットを条件で絞って新しい順に見る
 * (GAS版で「日報」「事故報告」シートを見ていたことの置き換え)。押すと中身を読むだけのダイアログを開く。
 * CSV はシートと同じ列で、絞り込んだ条件の全件。
 */
export function ReportListPanel() {
  const [form, setForm] = useState<ReportListFilters>(defaultFilters);
  const [applied, setApplied] = useState<ReportListFilters>(form);
  // 開いたまま日付をまたいだら、期間を変えていなければ今日までにする
  useFollowDefaultRange(defaultRange, setForm, setApplied);
  const [openId, setOpenId] = useState<string | null>(null);
  const csv = useFileDownload<ReportCsvSheet>();
  const staff = useQuery({
    queryKey: queryKeys.activeStaff,
    queryFn: ({ signal }) => staffApi.listActive(signal),
    staleTime: Number.POSITIVE_INFINITY,
    select: (res) => res.staff,
  });
  const customers = useCustomerList();

  const reports = useInfiniteQuery({
    queryKey: adminQueryKeys.reports(applied),
    queryFn: ({ pageParam, signal }) => reportsApi.list(applied, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const set = <K extends keyof ReportListFilters>(key: K, value: ReportListFilters[K]) =>
    setForm((f) => ({ ...f, [key]: value || undefined }));
  const items = reports.data?.pages.flatMap((p) => p.reports) ?? [];
  const firstPage = reports.data?.pages[0];
  const sortedCustomers = [...(customers.data?.customers ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, 'ja'),
  );

  return (
    <section aria-labelledby="adminReportsHeading" className="space-y-4">
      <h2 id="adminReportsHeading" className="sr-only">
        報告一覧
      </h2>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          // 同じ条件でもう一度押したら読み直す(新しい報告を見るため)
          if (JSON.stringify(form) === JSON.stringify(applied)) void reports.refetch();
          else setApplied(form);
        }}
        className="bg-gray-50 p-3 rounded-2xl space-y-3"
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="reportListFrom" className="block text-sm font-bold text-gray-700 mb-1">
              いつから
            </label>
            <input
              id="reportListFrom"
              type="date"
              value={form.from ?? ''}
              onChange={(e) => set('from', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="reportListTo" className="block text-sm font-bold text-gray-700 mb-1">
              いつまで
            </label>
            <input
              id="reportListTo"
              type="date"
              value={form.to ?? ''}
              onChange={(e) => set('to', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>
        <div>
          <label htmlFor="reportListKind" className="block text-sm font-bold text-gray-700 mb-1">
            種類
          </label>
          <select
            id="reportListKind"
            value={form.kind ?? ''}
            onChange={(e) => set('kind', e.target.value as ReportKind)}
            className={INPUT_CLASS}
          >
            <option value="">すべて</option>
            {REPORT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {REPORT_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="reportListStaff" className="block text-sm font-bold text-gray-700 mb-1">
            書いたスタッフ
          </label>
          <select
            id="reportListStaff"
            value={form.staffId ?? ''}
            onChange={(e) => set('staffId', e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">すべて</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="reportListCustomer" className="block text-sm font-bold text-gray-700 mb-1">
            お客様
          </label>
          <select
            id="reportListCustomer"
            value={form.customerId ?? ''}
            onChange={(e) => set('customerId', e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">すべて</option>
            {sortedCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="w-full min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl"
        >
          絞り込む
        </button>
        <div className="flex flex-col gap-2">
          {/* 条件が誤っている(期間が長すぎる等)間は保存できない。断られたら理由を赤いお知らせで出す(ファイルにしない) */}
          {csvSheetsFor(applied.kind).map((sheet) => (
            <button
              key={sheet}
              type="button"
              disabled={reports.isError || csv.busy !== null}
              onClick={() =>
                void csv.run(sheet, () => reportsApi.downloadCsv(sheet, applied), 'CSVファイルを保存しました')
              }
              className="w-full min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl disabled:opacity-50"
            >
              {csv.busy === sheet ? '保存しています…' : CSV_LABELS[sheet]}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600">
          {`期間は${REPORT_LIST_MAX_RANGE_DAYS}日まで指定できます。CSVは絞り込んだ条件の全件で、スプレッドシートの「日報」「事故報告」と同じ列の順です。`}
        </p>
      </form>

      {reports.isPending ? (
        <Loading />
      ) : reports.isError ? (
        <ErrorState message={userMessageOf(reports.error)} />
      ) : (
        <>
          {firstPage ? (
            <p className="text-sm text-gray-700">{`${firstPage.range.from} 〜 ${firstPage.range.to}(新しい順)`}</p>
          ) : null}
          {items.length === 0 ? (
            <EmptyState icon="📋" title="この条件の報告はありません" />
          ) : (
            <ul className="space-y-2" aria-label="報告一覧">
              {items.map((report) => (
                <ReportItem key={report.id} report={report} onOpen={() => setOpenId(report.id)} />
              ))}
            </ul>
          )}
          {reports.hasNextPage ? (
            <button
              type="button"
              onClick={() => void reports.fetchNextPage()}
              disabled={reports.isFetchingNextPage}
              className="w-full min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
            >
              {reports.isFetchingNextPage ? '読み込んでいます…' : 'もっと見る'}
            </button>
          ) : null}
        </>
      )}
      <ReportDetailModal reportId={openId} onClose={() => setOpenId(null)} />
    </section>
  );
}
