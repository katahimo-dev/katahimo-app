import type { AddressKind, ArchiveReason, CustomerSource, Gender } from '../domain/model';

/** 日付の範囲 `[start, end)`('YYYY-MM-DD'。null は無限)。 */
export interface DateRangeValue {
  start: string | null;
  end: string | null;
}

export interface CustomerRecord {
  id: string;
  displayName: string;
  familyName: string;
  givenName: string;
  familyNameKana: string | null;
  givenNameKana: string | null;
  email: string | null;
  phone: string | null;
  memoEnc: Uint8Array | null;
  benefitMemberIdEnc: Uint8Array | null;
  evacuationSiteEnc: Uint8Array | null;
  archivedAt: Date | null;
  archiveReason: ArchiveReason | null;
  rowVersion: number;
}

export interface NewCustomerInput {
  id: string;
  displayName: string;
  familyName: string;
  givenName: string;
  familyNameKana?: string | null;
  givenNameKana?: string | null;
  email?: string | null;
  phone?: string | null;
  memoEnc?: Uint8Array | null;
  benefitMemberIdEnc?: Uint8Array | null;
  evacuationSiteEnc?: Uint8Array | null;
}

export type CustomerPatch = Partial<Omit<NewCustomerInput, 'id'>>;

/** 一覧画面用(顧客の主の住所の市区町村を含む)。 */
export interface CustomerSummary {
  id: string;
  displayName: string;
  phone: string | null;
  city: string | null;
}

export interface CustomerRepository {
  findById(id: string): Promise<CustomerRecord | null>;
  /** アーカイブされていない顧客の一覧(主の住所の市区町村つき)。 */
  listActiveSummaries(): Promise<CustomerSummary[]>;
  /** 苗字(正規化済み)の完全一致。 */
  findByFamilyName(familyName: string): Promise<CustomerSummary[]>;
  create(input: NewCustomerInput): Promise<CustomerRecord>;
  /** expectedVersion を渡すと row_version が一致するときだけ更新する(違えば conflict)。 */
  update(id: string, patch: CustomerPatch, expectedVersion?: number): Promise<CustomerRecord>;
  archive(id: string, reason: ArchiveReason, at: Date): Promise<void>;
  unarchive(id: string): Promise<void>;
}

export interface CustomerSourceRecord {
  id: string;
  customerId: string;
  source: CustomerSource;
  externalId: string;
  attributes: Record<string, string>;
  externalRegisteredAt: Date | null;
  externalUpdatedAt: Date | null;
}

export interface CustomerSourceRecordRepository {
  findByExternalId(source: CustomerSource, externalId: string): Promise<CustomerSourceRecord | null>;
  findByCustomerId(customerId: string): Promise<CustomerSourceRecord | null>;
  /** 取込元の外部ID → 顧客ID(アーカイブ済みの顧客も含む)。 */
  mapExternalIds(source: CustomerSource): Promise<Map<string, { customerId: string; archived: boolean }>>;
  upsert(
    input: Omit<CustomerSourceRecord, 'id'> & { id: string; lastImportRunId: string | null },
  ): Promise<void>;
}

export interface CustomerAddressRecord {
  id: string;
  customerId: string;
  kind: AddressKind;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  addressLine: string;
  building: string | null;
  parkingArea: string | null;
  parkingDetail: string | null;
  geoEnc: Uint8Array | null;
  geoCell: string | null;
  valid: DateRangeValue;
  isPrimary: boolean;
}

export type CustomerAddressInput = CustomerAddressRecord;

export interface CustomerAddressRepository {
  listByCustomer(customerId: string): Promise<CustomerAddressRecord[]>;
  /** アーカイブされていない全顧客の住所(予定の突き合わせ・ルート計算のマスタ)。 */
  listForActiveCustomers(): Promise<CustomerAddressRecord[]>;
  insert(input: CustomerAddressInput): Promise<void>;
  update(id: string, patch: Partial<Omit<CustomerAddressInput, 'id' | 'customerId'>>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CustomerContactRecord {
  id: string;
  customerId: string;
  relation: string | null;
  nameEnc: Uint8Array | null;
  phoneEnc: Uint8Array | null;
  notesEnc: Uint8Array | null;
  isEmergency: boolean;
  sortOrder: number;
}

export interface CustomerContactRepository {
  listByCustomer(customerId: string): Promise<CustomerContactRecord[]>;
  insert(input: CustomerContactRecord): Promise<void>;
  update(id: string, patch: Partial<Omit<CustomerContactRecord, 'id' | 'customerId'>>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CareRecipientRecord {
  id: string;
  customerId: string;
  name: string;
  nameKana: string | null;
  birthDate: string | null;
  sex: Gender | null;
  allergyEnc: Uint8Array | null;
  needsEnc: Uint8Array | null;
  sortOrder: number;
  archivedAt: Date | null;
}

export interface CareRecipientRepository {
  /** includeArchived が false ならアーカイブ済みを除く。並びは sort_order。 */
  listByCustomer(customerId: string, options?: { includeArchived?: boolean }): Promise<CareRecipientRecord[]>;
  insert(input: Omit<CareRecipientRecord, 'archivedAt'>): Promise<void>;
  update(id: string, patch: Partial<Omit<CareRecipientRecord, 'id' | 'customerId'>>): Promise<void>;
}
