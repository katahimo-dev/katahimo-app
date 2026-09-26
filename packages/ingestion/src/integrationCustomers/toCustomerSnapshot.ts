import type { CustomerSource } from '@katahimo/core/domain';
import { extractCityFromAddress, extractPrefecture } from '@katahimo/core/domain';
import type { CustomerSnapshot, CustomerSnapshotAddress } from '@katahimo/core/usecases';
import type { IntegrationCustomer } from '@katahimo/shared';

type AddressInput = NonNullable<IntegrationCustomer['home']>;

function toAddress(address: AddressInput): CustomerSnapshotAddress {
  return {
    addressLine: address.addressLine,
    // 省かれたら住所から取り出す(訪問先一覧の地区の絞り込み。顧客CSVの取込と同じ規則)
    prefecture: address.prefecture ?? extractPrefecture(address.addressLine),
    city: address.city ?? (extractCityFromAddress(address.addressLine) || null),
    parkingArea: address.parkingArea ?? null,
    parkingDetail: address.parkingDetail ?? null,
    // 緯度経度は顧客CSVと同じ「緯度, 経度」の表記で持つ(@katahimo/shared parseLatLngText が読む)
    latLng: address.lat != null && address.lng != null ? `${address.lat}, ${address.lng}` : null,
  };
}

/** 省いた(undefined)まとまりは省いたまま、null は null、値があれば変換する。 */
function mapPresent<T, U>(value: T | null | undefined, map: (v: T) => U): U | null | undefined {
  return value === undefined ? undefined : value === null ? null : map(value);
}

/**
 * 外部システムから受け取った1顧客分(POST /api/integrations/customers の1件)を、取込元の形式を知らない顧客の形
 * (CustomerSnapshot)にする。source は API キーの取込元(要求の本文では決めない)。省いた項目は undefined のまま
 * 渡す(applyCustomerSnapshot の omitted = keep で今の値を保つ)。null は空にする。
 */
export function integrationCustomerToSnapshot(
  source: CustomerSource,
  customer: IntegrationCustomer,
): CustomerSnapshot {
  return {
    source,
    externalId: customer.externalId,
    // null・空は「姓 名」(applyCustomerSnapshot が作る)
    displayName: customer.displayName,
    familyName: customer.familyName,
    givenName: customer.givenName,
    familyNameKana: customer.familyNameKana,
    givenNameKana: customer.givenNameKana,
    email: customer.email,
    phone: customer.phone,
    memo: customer.memo,
    benefitMemberId: customer.benefitMemberId,
    evacuationSite: customer.evacuationSite,
    attributes: customer.attributes,
    externalRegisteredAt: mapPresent(customer.externalRegisteredAt, (at) => new Date(at)),
    externalUpdatedAt: mapPresent(customer.externalUpdatedAt, (at) => new Date(at)),
    home: mapPresent(customer.home, toAddress),
    secondary: mapPresent(customer.secondary, (secondary) => ({
      ...toAddress(secondary),
      validFrom: secondary.validFrom ?? null,
      validTo: secondary.validTo ?? null,
    })),
    emergencyContact: mapPresent(customer.emergencyContact, (contact) => ({
      relation: contact.relation ?? null,
      phone: contact.phone ?? null,
    })),
    recipients:
      mapPresent(customer.recipients, (recipients) =>
        recipients.map((r) => ({
          name: r.name,
          birthDate: r.birthDate ?? null,
          needs: r.needs ?? null,
          allergy: r.allergy ?? null,
        })),
      ) ?? undefined,
  };
}
