import { extractAllergy, extractCityFromAddress, extractPrefecture, toIsoDate } from '@katahimo/core/domain';
import type { CustomerSnapshot } from '@katahimo/core/usecases';
import type { ReservaCsvRow } from './types';

const orNull = (value: string): string | null => value.trim() || null;

/**
 * RESERVA の顧客CSVの1行を、取込元の形式を知らない顧客の形(CustomerSnapshot)にする。
 * 姓・名は CSV で分割済みの値を使う。個人を特定しない分類値(会員種別・支払方法等)は取込元の属性として持つ。
 * 子どもの生年月日が読めなければ null にし、元の表記を配慮事項の先頭に残す(情報を落とさない)。
 */
export function toCustomerSnapshot(row: ReservaCsvRow): CustomerSnapshot {
  const attributes: Record<string, string> = {};
  const put = (key: string, value: string) => {
    if (value.trim()) attributes[key] = value.trim();
  };
  put('member_type', row.memberType);
  put('member_status', row.memberStatus);
  put('payment_method', row.paymentMethod);
  put('payment_status', row.paymentStatus);
  put('gender', row.gender);
  put('age_bracket', row.ageBracket);
  put('country_code', row.countryCode);

  const address = row.address.trim();
  const address2 = row.address2.trim();
  return {
    source: 'reserva',
    externalId: row.customerId,
    displayName: `${row.familyName} ${row.givenName}`.trim(),
    familyName: row.familyName,
    givenName: row.givenName,
    familyNameKana: orNull(row.familyNameKana),
    givenNameKana: orNull(row.givenNameKana),
    email: orNull(row.email),
    phone: orNull(row.phone),
    memo: orNull(row.memo),
    benefitMemberId: orNull(row.benefitMemberId),
    evacuationSite: orNull(row.evacuationSite),
    attributes,
    externalRegisteredAt: row.registeredAt ? new Date(row.registeredAt) : null,
    externalUpdatedAt: row.externalLastUpdatedAt ? new Date(row.externalLastUpdatedAt) : null,
    home: address
      ? {
          addressLine: address,
          prefecture: extractPrefecture(address),
          // 訪問先一覧の地区の絞り込みに使う値(GAS版 Main.js fetchDataFromSheet の住所パーサーの移植)
          city: extractCityFromAddress(address) || null,
          parkingArea: orNull(row.parkingArea),
          parkingDetail: orNull(row.parkingDetail),
          latLng: orNull(row.latLng),
        }
      : null,
    secondary: address2
      ? {
          addressLine: address2,
          prefecture: extractPrefecture(address2),
          city: extractCityFromAddress(address2) || null,
          validFrom: toIsoDate(row.address2StartDate),
          validTo: toIsoDate(row.address2EndDate),
        }
      : null,
    emergencyContact:
      row.emergencyContact.trim() || row.emergencyContactRelation.trim()
        ? { phone: orNull(row.emergencyContact), relation: orNull(row.emergencyContactRelation) }
        : null,
    recipients: row.familyMembers
      .filter((m) => m.name.trim())
      .map((m) => {
        const birthDate = toIsoDate(m.dob);
        const unreadDob = !birthDate && m.dob.trim() ? `生年月日: ${m.dob.trim()}` : '';
        return {
          name: m.name.trim(),
          birthDate,
          needs: [unreadDob, m.info.trim()].filter(Boolean).join(' ') || null,
          allergy: extractAllergy(m.info) ?? null,
        };
      }),
  };
}
