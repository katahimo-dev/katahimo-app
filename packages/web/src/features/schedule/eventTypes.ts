/** 予定の種類(GAS版 isCustomerEventType_ / formatEventTypeLabel_ / SCHEDULE_EVENT_TYPE_ICON_ / _BORDER_)。 */

export const CUSTOMER_APPOINTMENT = 'CUSTOMER APPOINTMENT';

/** お客様の訪問か(日報ボタン・住所・地図ボタンを出すのはお客様の訪問だけ) */
export function isCustomerEventType(eventType: string): boolean {
  return eventType === CUSTOMER_APPOINTMENT;
}

export function formatEventTypeLabel(eventType: string): string {
  if (eventType === 'CUSTOMER APPOINTMENT') return 'お客様の訪問';
  if (eventType === 'OFFICE WORK') return '事務作業';
  if (eventType === 'EVENT') return 'イベント';
  return eventType || '';
}

const ICONS: Record<string, string> = { 'CUSTOMER APPOINTMENT': '📍', 'OFFICE WORK': '📝', EVENT: '📅' };
const BORDERS: Record<string, string> = {
  'CUSTOMER APPOINTMENT': 'border-l-4 border-l-blue-400',
  'OFFICE WORK': 'border-l-4 border-l-gray-300',
  EVENT: 'border-l-4 border-l-teal-400',
};

export function eventTypeIcon(eventType: string): string {
  return ICONS[eventType] ?? '🕒';
}

/** カードの左の枠線の色(種類が分からないときは付けない) */
export function eventTypeBorderClass(eventType: string): string {
  return BORDERS[eventType] ?? '';
}
