import {
  ACCIDENT_FIELD_LABELS,
  DAILY_FIELD_LABELS,
  formatZonedDateTime,
  REPORT_KIND_LABELS,
  type ReportDetail,
} from '@katahimo/shared';
import { useQuery } from '@tanstack/react-query';
import { userMessageOf } from '../../../api/client';
import { reportsApi } from '../../../api/reports';
import { Modal, ModalFooter, ModalHeader } from '../../../ui/modal';
import { ErrorState, Loading } from '../../../ui/StatusViews';
import { adminQueryKeys } from '../adminQueryKeys';
import { DELETED_STAFF, REPORT_KIND_BADGE, UNKNOWN_CUSTOMER } from './reportFormat';

/** 事故報告の項目の並び(日報ダイアログ・「事故報告」シートと同じ)。 */
const ACCIDENT_FIELDS = [
  'targetName',
  'targetDob',
  'occurrenceTime',
  'location',
  'accidentContent',
  'situation',
  'immediateResponse',
  'parentCorrespondence',
  'diagnosisTreatment',
  'prevention',
  'inputText',
] as const;

const DAILY_FIELDS = ['internalText', 'customerText', 'inputText'] as const;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-bold text-gray-700">{label}</dt>
      <dd className="text-base text-gray-800 whitespace-pre-wrap break-words">{value || '-'}</dd>
    </div>
  );
}

function DetailBody({ report, timeZone }: { report: ReportDetail; timeZone: string }) {
  const updated = formatZonedDateTime(report.updatedAt, timeZone).slice(0, 16);
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 flex-wrap">
          <span
            className={`text-sm font-bold text-white px-2 py-0.5 rounded ${REPORT_KIND_BADGE[report.kind]}`}
          >
            {REPORT_KIND_LABELS[report.kind]}
          </span>
          <span className="text-sm font-bold text-gray-700">{report.date.replaceAll('-', '/')}</span>
          <span className="text-sm text-gray-600">{report.time}</span>
        </p>
        <p className="font-bold text-gray-800 text-lg">{report.customerName ?? UNKNOWN_CUSTOMER}</p>
        <p className="text-sm text-gray-700">{`書いた人: ${report.staffName ?? DELETED_STAFF}`}</p>
        <p className="text-sm text-gray-600">
          {`最後に保存: ${updated}`}
          {report.revisionCount > 0 ? `(${report.revisionCount}回 直しています)` : ''}
        </p>
      </div>
      {report.kind === 'daily_report' ? (
        <dl className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <span className="text-sm font-bold bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200">
              {`PSI: ${report.riskRating ?? '-'}`}
            </span>
            <span className="text-sm font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200">
              {`ES: ${report.esRating ?? '-'}`}
            </span>
          </div>
          {DAILY_FIELDS.map((field) => (
            <Field key={field} label={DAILY_FIELD_LABELS[field]} value={report.content[field]} />
          ))}
        </dl>
      ) : (
        <dl className="space-y-3">
          {ACCIDENT_FIELDS.map((field) => (
            <Field key={field} label={ACCIDENT_FIELD_LABELS[field]} value={report.content[field]} />
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * 報告一覧から開く、記録1件の中身(読むだけ)。直すときはお客様の日報ダイアログから保存し直す。
 */
export function ReportDetailModal({ reportId, onClose }: { reportId: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: adminQueryKeys.reportDetail(reportId ?? ''),
    queryFn: ({ signal }) => reportsApi.detail(reportId ?? '', signal),
    enabled: reportId !== null,
  });

  return (
    <Modal
      open={reportId !== null}
      labelledBy="reportDetailTitle"
      onClose={onClose}
      className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 transition-opacity duration-300"
    >
      <div className="bg-white w-full max-w-md rounded-2xl border border-gray-200 flex flex-col max-h-[90vh]">
        <ModalHeader title="報告の中身" titleId="reportDetailTitle" onClose={onClose} />
        <div className="p-4 overflow-y-auto">
          {detail.isPending ? (
            <Loading />
          ) : detail.isError ? (
            <ErrorState message={userMessageOf(detail.error)} />
          ) : (
            <DetailBody report={detail.data.report} timeZone={detail.data.timeZone} />
          )}
        </div>
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 px-6 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            閉じる
          </button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
