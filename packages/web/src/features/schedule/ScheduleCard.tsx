import { mapsSearchUrl } from '../../lib/mapsUrl';
import { eventTypeBorderClass, eventTypeIcon, formatEventTypeLabel, isCustomerEventType } from './eventTypes';
import { MapPinIcon } from './MapPinIcon';
import type { ScheduleItem } from './scheduleItems';

/**
 * 予定の1件のカード(GAS版 renderSchedule / renderScheduleWithRoute のカード部分と applyEventTypeStyling_)。
 * お客様の訪問以外(事務作業・イベント)は灰色にし、日報ボタンは出さない。
 */
export function ScheduleCard({
  item,
  onWriteReport,
}: {
  item: ScheduleItem;
  onWriteReport: (scheduleName: string) => void;
}) {
  const isCustomer = isCustomerEventType(item.eventType);
  const border = eventTypeBorderClass(item.eventType);
  const cardClass = isCustomer
    ? `bg-white rounded-xl shadow-sm border border-gray-100 ${border} p-3`
    : `rounded-xl shadow-sm border border-gray-100 ${border} p-3 bg-gray-50 border-gray-200`;

  return (
    <div className={cardClass}>
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 text-center w-16">
          <div className={`text-sm font-bold ${isCustomer ? 'text-gray-800' : 'text-gray-500'}`}>
            {item.start}
          </div>
          <div className="text-sm text-gray-600">〜{item.end}</div>
        </div>
        <div className="flex-grow min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-sm leading-none flex-shrink-0">{eventTypeIcon(item.eventType)}</span>
            <span className={`font-bold truncate ${isCustomer ? 'text-gray-800' : 'text-gray-600'}`}>
              {item.name || '（名前なし）'}
            </span>
          </div>
          <ScheduleSubtitle item={item} />
        </div>
      </div>
      {isCustomer ? (
        <button
          type="button"
          onClick={() => onWriteReport(item.name)}
          className="w-full min-h-12 mt-3 py-3 rounded-xl bg-blue-600 text-white text-base font-bold transform transition-transform active:scale-95"
        >
          ✏️ この訪問の日報を書く
        </button>
      ) : null}
    </div>
  );
}

/**
 * カードの2行目(GAS版 scheduleSubtitleHtml_)。お客様の訪問は住所と地図ボタン、
 * それ以外は種類の名前(事務作業・イベント)だけ。
 */
function ScheduleSubtitle({ item }: { item: ScheduleItem }) {
  if (!isCustomerEventType(item.eventType)) {
    return <div className="text-sm text-gray-600 mt-0.5">{formatEventTypeLabel(item.eventType)}</div>;
  }
  if (!item.address) {
    return <div className="text-sm text-gray-600 mt-0.5">住所が登録されていません（事務局へ連絡）</div>;
  }
  return (
    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
      <span className="text-sm text-gray-500 truncate">{item.address}</span>
      <a
        href={mapsSearchUrl(item.address)}
        target="_blank"
        rel="noreferrer"
        className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-600 text-sm font-bold rounded active:bg-blue-200"
      >
        <MapPinIcon className="w-2.5 h-2.5" />
        地図
      </a>
    </div>
  );
}
