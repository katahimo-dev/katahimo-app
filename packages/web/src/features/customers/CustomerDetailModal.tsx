import type { CustomerListItem } from '@katahimo/shared';
import { useQuery } from '@tanstack/react-query';
import { customerQueryKeys, customersApi } from '../../api/customers';
import { NETWORK_ERROR_MESSAGE } from '../../lib/messages';
import { FadeModal, ModalFooter, ModalHeader } from '../../ui/modal';
import { ErrorState, Loading } from '../../ui/StatusViews';
import { MapPinIcon } from '../schedule/MapPinIcon';
import { buildDetailRows, buildFamilyRows, type DetailAction, type DetailRow } from './customerDetailRows';

/**
 * 「お客様の情報」ダイアログ(GAS版 #customerDetailModal / showCustomerDetail)。
 * お子様・ご家族(アレルギーは赤)と、住所・連絡先(地図・メール・電話のボタンつき)。
 */
export function CustomerDetailModal({
  open,
  customer,
  onClose,
}: {
  open: boolean;
  customer: CustomerListItem | null;
  onClose: () => void;
}) {
  const customerId = customer?.id ?? '';
  const detailQuery = useQuery({
    queryKey: customerQueryKeys.detail(customerId),
    queryFn: ({ signal }) => customersApi.detail(customerId, signal),
    enabled: open && Boolean(customerId),
    select: (res) => res.customer,
  });
  const detail = detailQuery.data;

  return (
    <FadeModal
      open={open}
      labelledBy="customerDetailTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 transition-opacity"
    >
      <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col transform transition-transform scale-95">
        <ModalHeader
          title="お客様の情報"
          titleId="customerDetailTitle"
          titleClassName="font-bold text-lg text-gray-800"
          onClose={onClose}
        />
        <div className="p-6 overflow-y-auto space-y-6">
          {detail ? (
            <>
              <div>
                <h4 className="font-bold text-gray-800 text-base mb-2 border-l-4 border-blue-600 pl-2">
                  お子様・ご家族
                </h4>
                <div className="space-y-2">
                  {detail.familyMembers.length > 0 ? (
                    buildFamilyRows(detail.familyMembers).map((f) => (
                      <div key={f.id} className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                        <div className="font-bold text-gray-800">
                          {f.name} <span className="text-sm font-normal text-gray-500 ml-1">{f.dob}</span>
                        </div>
                        <div className="text-base text-red-600 font-bold mt-1">{f.allergyLabel}</div>
                        <div className="text-sm text-gray-600 mt-0.5 text-wrap break-words">{f.info}</div>
                      </div>
                    ))
                  ) : (
                    <p className="text-gray-600 text-base">登録なし</p>
                  )}
                </div>
              </div>
              <div>
                <h4 className="font-bold text-gray-800 text-base mb-2 border-l-4 border-green-600 pl-2">
                  住所・連絡先
                </h4>
                <div className="grid grid-cols-1 gap-y-2 text-base">
                  {buildDetailRows(detail).map((row) => (
                    <DetailRowView key={row.key} row={row} />
                  ))}
                </div>
              </div>
            </>
          ) : detailQuery.isError ? (
            <ErrorState message={NETWORK_ERROR_MESSAGE} />
          ) : (
            <Loading />
          )}
        </div>
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 px-4 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            閉じる
          </button>
        </ModalFooter>
      </div>
    </FadeModal>
  );
}

function DetailRowView({ row }: { row: DetailRow }) {
  return (
    <div className="border-b border-gray-100 pb-2">
      <div className="text-sm text-gray-500 mb-0.5">{row.key}</div>
      <div className="text-gray-800 text-sm leading-relaxed">
        {row.action ? (
          <div className="flex items-start gap-2">
            <span className="break-words flex-grow">{row.value}</span>
            <DetailActionButton action={row.action} />
          </div>
        ) : (
          <span className="break-words">{row.value}</span>
        )}
      </div>
    </div>
  );
}

const ACTION_ICON_PATHS: Record<Exclude<DetailAction['kind'], 'map'>, string> = {
  mail: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  tel: 'M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z',
};

/** 地図(青)・メール(青)・電話(緑)のボタン */
function DetailActionButton({ action }: { action: DetailAction }) {
  const color = action.kind === 'tel' ? 'bg-green-600' : 'bg-blue-600';
  const label = action.kind === 'map' ? '地図' : action.kind === 'mail' ? 'メール' : '電話';
  return (
    <a
      href={action.href}
      target={action.kind === 'map' ? '_blank' : '_top'}
      rel={action.kind === 'map' ? 'noreferrer' : undefined}
      className={`flex-shrink-0 min-h-11 px-3 py-2 ${color} text-white text-sm font-bold rounded-xl flex items-center gap-1`}
    >
      {action.kind === 'map' ? (
        <MapPinIcon className="w-3 h-3" />
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d={ACTION_ICON_PATHS[action.kind]}
          />
        </svg>
      )}
      {label}
    </a>
  );
}
