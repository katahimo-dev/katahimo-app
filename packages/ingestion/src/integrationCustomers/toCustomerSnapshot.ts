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
    parkingArea: address.parkingArea,
    parkingDetail: address.parkingDetail,
    // 緯度経度は顧客CSVと同じ「緯度, 経度」の表記で持つ(@katahimo/shared parseLatLngText が読む)
    latLng: address.lat != null && address.lng != null ? `${address.lat}, ${address.lng}` : null,
  };
}

/**
 * 外部システムから受け取った1顧客分(POST /api/integrations/customers の1件)を、取込元の形式を知らない顧客の形
 * (CustomerSnapshot)にする。source は API キーの取込元(要求の本文では決めない)。
 */
export function integrationCustomerToSnapshot(
  source: CustomerSource,
  customer: IntegrationCustomer,
): CustomerSnapshot {
  return {
    source,
    externalId: customer.externalId,
    displayName: customer.displayName ?? `${customer.familyName} ${customer.givenName}`.trim(),
    familyName: customer.familyName,
    givenName: customer.givenName,
    familyNameKana: customer.familyNameKana,
    givenNameKana: customer.givenNameKana,
    email: customer.email ?? null,
    phone: customer.phone,
    memo: customer.memo,
    benefitMemberId: customer.benefitMemberId,
    evacuationSite: customer.evacuationSite,
    attributes: customer.attributes,
    externalRegisteredAt: customer.externalRegisteredAt ? new Date(customer.externalRegisteredAt) : null,
    externalUpdatedAt: customer.externalUpdatedAt ? new Date(customer.externalUpdatedAt) : null,
    home: customer.home ? toAddress(customer.home) : null,
    secondary: customer.secondary
      ? {
          ...toAddress(customer.secondary),
          validFrom: customer.secondary.validFrom ?? null,
          validTo: customer.secondary.validTo ?? null,
        }
      : null,
    emergencyContact: customer.emergencyContact ?? null,
    recipients: customer.recipients.map((r) => ({
      name: r.name,
      birthDate: r.birthDate ?? null,
      needs: r.needs,
      allergy: r.allergy,
    })),
  };
}
