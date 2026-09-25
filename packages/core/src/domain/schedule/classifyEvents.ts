import { normalizeStaffName } from '../staffName';
import { parseEventTitle } from './eventTitle';
import { mergeOverlappingOfficeWork } from './officeWork';
import type { Appointment, CalendarEvent, CalendarEventSource, Place, ScheduleCustomer } from './types';

/**
 * カレンダー予定を分類し、ルート計算に使える予定(Appointment)に変換する。
 *
 * 移植元: RouteSearch.js getCalendarEvents + mergeOverlappingOfficeWork。
 * - 同じ予定が複数カレンダーに載っていれば、先に読んだカレンダーの1件だけを使う。
 *   持ち主が「いいえ」と回答した予定は、そのカレンダーの分としては読まない。
 * - [予約確定]: 説明欄の「施設：<スタッフ名>[」を担当者とし、タイトルの氏名で顧客DBと突合する。
 *   説明欄に「オンライン」を含む予約は訪問しないため場所を持たない(ルート計算の対象外)。
 * - [新規]/[事務]: カレンダーの持ち主が担当。場所は予定の「場所」欄。
 * - [イベント]: ゲスト全員が担当(ゲストがいなければカレンダーの持ち主)。
 * - 同じスタッフの重なる[事務]は1件にまとめる(officeWork.ts)。
 *
 * GAS版との差分(意図的): GAS版はオンライン予約で顧客オブジェクトそのものの住所を消しており、
 * 同じ日に同じ顧客の対面予約があるとそちらの住所まで消えていた(共有オブジェクトの書き換え)。
 * ここでは該当予定の場所だけを空にする。また、場所のジオコーディングはルート計算時まで行わない
 * (GAS版は軽量版の予定一覧でも[新規]等の場所をジオコーディングしていたが、結果は使っていなかった)。
 */
export function classifyCalendarEvents(
  sources: CalendarEventSource[],
  customers: ScheduleCustomer[],
): Appointment[] {
  const findCustomer = buildCustomerLookup(customers);
  const appointments = collectUniqueEvents(sources)
    .map(({ event, ownerName }) => classifyEvent(event, ownerName, findCustomer))
    .filter((a): a is Appointment => a !== null);
  return mergeOverlappingOfficeWork(appointments);
}

interface OwnedEvent {
  event: CalendarEvent;
  ownerName: string;
}

function collectUniqueEvents(sources: CalendarEventSource[]): OwnedEvent[] {
  const unique = new Map<string, OwnedEvent>();
  for (const { ownerName, events } of sources) {
    for (const event of events) {
      if (event.declinedByOwner || unique.has(event.dedupeKey)) continue;
      unique.set(event.dedupeKey, { event, ownerName });
    }
  }
  return [...unique.values()];
}

type CustomerLookup = (name: string) => ScheduleCustomer | undefined;

/** 顧客名の空白差異を無視して突合する。同名の顧客が複数いれば先頭の1人(GAS版 Array.find と同じ)。 */
function buildCustomerLookup(customers: ScheduleCustomer[]): CustomerLookup {
  const byName = new Map<string, ScheduleCustomer>();
  for (const customer of customers) {
    const key = normalizeStaffName(customer.name);
    if (!byName.has(key)) byName.set(key, customer);
  }
  return (name) => byName.get(normalizeStaffName(name));
}

const FACILITY_STAFF_PATTERN = /施設：(.*?)\[/;
const URL_PATTERN = /https?:\/\/[\w/:%#$&?()~.=+-]+/;
const NO_PLACE: Place = { address: '', latLng: null };

function classifyEvent(
  event: CalendarEvent,
  ownerName: string,
  findCustomer: CustomerLookup,
): Appointment | null {
  const { tag, name } = parseEventTitle(event.title);
  const base = { start: event.start, end: event.end, name, customerId: '', reservaUrl: '' };
  const placeFromLocation: Place = { address: event.location, latLng: null };

  switch (tag) {
    case 'confirmed':
      return classifyReservation(event, ownerName, name, findCustomer);
    case 'newCustomer':
      return { ...base, type: 'CUSTOMER APPOINTMENT', place: placeFromLocation, assigneeNames: [ownerName] };
    case 'specialEvent':
      return {
        ...base,
        type: 'EVENT',
        place: placeFromLocation,
        assigneeNames: event.guestNames.length > 0 ? event.guestNames : [ownerName],
      };
    case 'officeWork':
      return { ...base, type: 'OFFICE WORK', place: placeFromLocation, assigneeNames: [ownerName] };
    case null:
      return null;
  }
}

/** RESERVAの予約確定([予約確定])。 */
function classifyReservation(
  event: CalendarEvent,
  ownerName: string,
  customerName: string,
  findCustomer: CustomerLookup,
): Appointment {
  const { description } = event;
  const staffName = FACILITY_STAFF_PATTERN.exec(description)?.[1]?.trim() ?? ownerName;
  const isOnline = description.includes('オンライン');
  const customer = findCustomer(customerName);

  return {
    type: 'CUSTOMER APPOINTMENT',
    start: event.start,
    end: event.end,
    name: customer?.name ?? customerName,
    customerId: customer?.customerId ?? '',
    place: isOnline || !customer ? NO_PLACE : customer.place,
    reservaUrl: URL_PATTERN.exec(description)?.[0] ?? '',
    assigneeNames: [staffName],
  };
}
