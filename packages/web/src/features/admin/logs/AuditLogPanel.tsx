import {
  ACTOR_TYPE_LABELS,
  APP_LOG_LEVEL_LABELS,
  APP_LOG_LEVELS,
  type AppLogLevel,
  AUDIT_LOG_CATEGORIES,
  AUDIT_LOG_DEFAULT_RANGE_DAYS,
  type AuditLogEntry,
  auditActionLabel,
  formatAuditDetails,
  formatZonedDateTime,
} from '@katahimo/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type AuditLogFilters, auditLogsApi } from '../../../api/admin';
import { userMessageOf } from '../../../api/client';
import { addDaysYmd, BUSINESS_TIME_ZONE, todayJst } from '../../../lib/date';
import { useFileDownload } from '../../../lib/useFileDownload';
import { EmptyState, ErrorState, Loading } from '../../../ui/StatusViews';
import { adminQueryKeys } from '../adminQueryKeys';
import { INPUT_CLASS } from '../components/FormField';
import { useAdminStaffList } from '../staff/useAdminStaff';

const LEVEL_BADGE: Record<AppLogLevel, string> = {
  INFO: 'bg-gray-200 text-gray-800',
  WARN: 'bg-amber-100 text-amber-900',
  ERROR: 'bg-red-100 text-red-800',
  SECURITY: 'bg-purple-100 text-purple-800',
};

const DELETED_STAFF = '(削除されたスタッフ)';

function defaultFilters(): AuditLogFilters {
  const to = todayJst();
  return { from: addDaysYmd(to, -(AUDIT_LOG_DEFAULT_RANGE_DAYS - 1)), to };
}

function actorText(entry: AuditLogEntry): string {
  if (entry.actorType !== 'staff') return ACTOR_TYPE_LABELS[entry.actorType];
  return entry.actorName ?? DELETED_STAFF;
}

function AuditLogItem({ entry, timeZone }: { entry: AuditLogEntry; timeZone: string }) {
  const details = formatAuditDetails(entry.details);
  const target = entry.targetStaffId ? (entry.targetName ?? DELETED_STAFF) : null;
  return (
    <li className="bg-white p-3 rounded-2xl border border-gray-200 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2 py-0.5 rounded-full text-sm font-bold ${LEVEL_BADGE[entry.level]}`}>
          {APP_LOG_LEVEL_LABELS[entry.level]}
        </span>
        <time dateTime={entry.createdAt} className="text-sm text-gray-700">
          {formatZonedDateTime(entry.createdAt, timeZone)}
        </time>
      </div>
      <p className="font-bold text-gray-800 text-base">{auditActionLabel(entry.action)}</p>
      <p className="text-sm text-gray-800">
        {actorText(entry)}
        {target ? ` → ${target}` : ''}
      </p>
      {details ? <p className="text-sm text-gray-600 break-all">{details}</p> : null}
      <p className="text-xs text-gray-500 break-all">
        {entry.action}
        {entry.ip ? ` ・ ${entry.ip}` : ''}
      </p>
    </li>
  );
}

/**
 * 管理画面「操作ログ」(GAS版の Drive の CSV ログの置き換え)。条件を決めて「絞り込む」で読み、
 * 「もっと見る」で続きを読む。CSV は同じ条件の全件。
 */
export function AuditLogPanel() {
  const staff = useAdminStaffList();
  const [form, setForm] = useState<AuditLogFilters>(defaultFilters);
  const [applied, setApplied] = useState<AuditLogFilters>(form);
  const csv = useFileDownload<'csv'>();

  const logs = useInfiniteQuery({
    queryKey: adminQueryKeys.auditLogs(applied),
    queryFn: ({ pageParam, signal }) => auditLogsApi.list(applied, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const set = <K extends keyof AuditLogFilters>(key: K, value: AuditLogFilters[K]) =>
    setForm((f) => ({ ...f, [key]: value || undefined }));
  const entries = logs.data?.pages.flatMap((p) => p.entries) ?? [];
  const firstPage = logs.data?.pages[0];

  return (
    <section aria-labelledby="adminLogsHeading" className="space-y-4">
      <h2 id="adminLogsHeading" className="sr-only">
        操作ログ
      </h2>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          // 同じ条件でもう一度押したら読み直す(新しい記録を見るため)
          if (JSON.stringify(form) === JSON.stringify(applied)) void logs.refetch();
          else setApplied(form);
        }}
        className="bg-gray-50 p-3 rounded-2xl space-y-3"
      >
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="auditLogFrom" className="block text-sm font-bold text-gray-700 mb-1">
              いつから
            </label>
            <input
              id="auditLogFrom"
              type="date"
              value={form.from ?? ''}
              onChange={(e) => set('from', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="auditLogTo" className="block text-sm font-bold text-gray-700 mb-1">
              いつまで
            </label>
            <input
              id="auditLogTo"
              type="date"
              value={form.to ?? ''}
              onChange={(e) => set('to', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>
        <div>
          <label htmlFor="auditLogLevel" className="block text-sm font-bold text-gray-700 mb-1">
            レベル
          </label>
          <select
            id="auditLogLevel"
            value={form.level ?? ''}
            onChange={(e) => set('level', e.target.value as AppLogLevel)}
            className={INPUT_CLASS}
          >
            <option value="">すべて</option>
            {APP_LOG_LEVELS.map((level) => (
              <option key={level} value={level}>
                {APP_LOG_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="auditLogStaff" className="block text-sm font-bold text-gray-700 mb-1">
            スタッフ(操作した人・対象)
          </label>
          <select
            id="auditLogStaff"
            value={form.staffId ?? ''}
            onChange={(e) => set('staffId', e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">すべて</option>
            {(staff.data?.staff ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.isRetired ? `${s.name}(退職)` : s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="auditLogAction" className="block text-sm font-bold text-gray-700 mb-1">
            操作の種類
          </label>
          <select
            id="auditLogAction"
            value={form.action ?? ''}
            onChange={(e) => set('action', e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">すべて</option>
            {AUDIT_LOG_CATEGORIES.map((c) => (
              <option key={c.prefix} value={c.prefix}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-3">
          <button
            type="submit"
            className="flex-1 min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl"
          >
            絞り込む
          </button>
          {/* 条件が誤っている(期間が長すぎる等)間は保存できない。断られたら理由を赤いお知らせで出す(ファイルにしない) */}
          <button
            type="button"
            disabled={logs.isError || csv.busy !== null}
            onClick={() =>
              void csv.run('csv', () => auditLogsApi.downloadCsv(applied), 'CSVファイルを保存しました')
            }
            className="flex-1 min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl disabled:opacity-50"
          >
            {csv.busy ? '保存しています…' : '⬇ CSVで保存'}
          </button>
        </div>
        <p className="text-sm text-gray-600">期間は93日まで指定できます。CSVは絞り込んだ条件の全件です。</p>
      </form>

      {logs.isPending ? (
        <Loading />
      ) : logs.isError ? (
        <ErrorState message={userMessageOf(logs.error)} />
      ) : (
        <>
          {firstPage ? (
            <p className="text-sm text-gray-700">{`${firstPage.range.from} 〜 ${firstPage.range.to}(新しい順)`}</p>
          ) : null}
          {entries.length === 0 ? (
            <EmptyState icon="📄" title="この条件の操作ログはありません" />
          ) : (
            <ul className="space-y-2" aria-label="操作ログ">
              {entries.map((entry) => (
                <AuditLogItem
                  key={entry.id}
                  entry={entry}
                  timeZone={firstPage?.timeZone ?? BUSINESS_TIME_ZONE}
                />
              ))}
            </ul>
          )}
          {logs.hasNextPage ? (
            <button
              type="button"
              onClick={() => void logs.fetchNextPage()}
              disabled={logs.isFetchingNextPage}
              className="w-full min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
            >
              {logs.isFetchingNextPage ? '読み込んでいます…' : 'もっと見る'}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
