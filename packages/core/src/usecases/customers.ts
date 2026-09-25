import { normalizeStaffName, splitJapaneseFullName } from '../domain';
import type { CryptoPort } from '../ports/crypto';
import type {
  CustomerPatchInput,
  CustomerRecord,
  CustomerRepositoryPort,
  EncryptedField,
  FamilyMemberRecord,
  FamilyMemberRepositoryPort,
  NewCustomerInput,
  NewFamilyMemberInput,
} from '../ports/repositories';

export interface CustomerDeps {
  customers: CustomerRepositoryPort;
  familyMembers: FamilyMemberRepositoryPort;
  crypto: CryptoPort;
}

async function encryptIfPresent(
  crypto: CryptoPort,
  tenantId: string,
  value: string | undefined | null,
): Promise<EncryptedField | null> {
  if (!value) return null;
  return crypto.encrypt(tenantId, value);
}

async function decryptIfPresent(
  crypto: CryptoPort,
  tenantId: string,
  value: EncryptedField | null,
): Promise<string | null> {
  if (!value) return null;
  return crypto.decrypt(tenantId, value);
}

export interface FamilyMemberInput {
  name: string;
  dob?: string;
  info?: string;
}

/**
 * 顧客登録の入力。RESERVA CSVの全項目(パスワード列を除く)を受け付けられるよう、
 * CustomerProfileFieldsに対応する項目を全て任意項目として持つ。
 *
 * familyName/givenNameを明示的に渡した場合はそれを優先する(CSV取込のように、外部システムが
 * 既に姓・名を分割済みで渡してくる場合、氏名文字列からの再分割よりも確実なため)。
 * 省略した場合は`splitJapaneseFullName(name)`で分割する(手動登録・デモ投入用)。
 */
export interface CreateCustomerInput {
  tenantId: string;
  name: string;
  familyName?: string;
  givenName?: string;
  externalSource?: string;
  externalId?: string;
  familyNameKana?: string;
  givenNameKana?: string;
  email?: string;
  phone?: string;
  addressDetail?: string;
  city?: string;
  parkingArea?: string;
  parkingDetail?: string;
  emergencyContact?: string;
  emergencyContactRelation?: string;
  evacuationSite?: string;
  memo?: string;
  benefitMemberId?: string;
  address2?: string;
  address2StartDate?: string;
  address2EndDate?: string;
  latLng?: string;
  memberType?: string;
  memberStatus?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  gender?: string;
  ageBracket?: string;
  registeredAt?: Date;
  externalLastUpdatedAt?: Date;
  familyMembers?: FamilyMemberInput[];
}

async function buildCustomerRecordFields(
  deps: CustomerDeps,
  tenantId: string,
  input: CreateCustomerInput,
): Promise<NewCustomerInput> {
  const familyName = input.familyName ?? splitJapaneseFullName(input.name).familyName;
  const givenName = input.givenName ?? splitJapaneseFullName(input.name).givenName;

  const [
    emergencyContactEnc,
    emergencyContactRelationEnc,
    evacuationSiteEnc,
    memoEnc,
    benefitMemberIdEnc,
    latLngEnc,
  ] = await Promise.all([
    encryptIfPresent(deps.crypto, tenantId, input.emergencyContact),
    encryptIfPresent(deps.crypto, tenantId, input.emergencyContactRelation),
    encryptIfPresent(deps.crypto, tenantId, input.evacuationSite),
    encryptIfPresent(deps.crypto, tenantId, input.memo),
    encryptIfPresent(deps.crypto, tenantId, input.benefitMemberId),
    encryptIfPresent(deps.crypto, tenantId, input.latLng),
  ]);

  return {
    tenantId,
    externalSource: input.externalSource ?? null,
    externalId: input.externalId ?? null,
    name: input.name,
    // normalizeStaffNameで正規化してから保存する(空白の表記ゆれがあっても検索が一致するように)。
    familyName: normalizeStaffName(familyName),
    givenName: normalizeStaffName(givenName),
    familyNameKana: input.familyNameKana ?? null,
    givenNameKana: input.givenNameKana ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    addressDetail: input.addressDetail ?? null,
    city: input.city ?? null,
    parkingArea: input.parkingArea ?? null,
    parkingDetail: input.parkingDetail ?? null,
    emergencyContact: emergencyContactEnc,
    emergencyContactRelation: emergencyContactRelationEnc,
    evacuationSite: evacuationSiteEnc,
    memo: memoEnc,
    benefitMemberId: benefitMemberIdEnc,
    address2: input.address2 ?? null,
    address2StartDate: input.address2StartDate ?? null,
    address2EndDate: input.address2EndDate ?? null,
    latLng: latLngEnc,
    memberType: input.memberType ?? null,
    memberStatus: input.memberStatus ?? null,
    paymentMethod: input.paymentMethod ?? null,
    paymentStatus: input.paymentStatus ?? null,
    gender: input.gender ?? null,
    ageBracket: input.ageBracket ?? null,
    registeredAt: input.registeredAt ?? null,
    externalLastUpdatedAt: input.externalLastUpdatedAt ?? null,
  };
}

async function buildFamilyMemberInputs(
  deps: CustomerDeps,
  tenantId: string,
  customerId: string,
  members: FamilyMemberInput[],
): Promise<NewFamilyMemberInput[]> {
  return Promise.all(
    members.map(async (m) => ({
      tenantId,
      customerId,
      name: await deps.crypto.encrypt(tenantId, m.name),
      dob: await encryptIfPresent(deps.crypto, tenantId, m.dob),
      info: await encryptIfPresent(deps.crypto, tenantId, m.info),
    })),
  );
}

/**
 * 顧客を登録する。氏名は姓・名に分割して平文で別カラムに保存し、「苗字だけで検索」に対応する。
 * 世帯構成員(子ども等)を渡した場合はfamily_membersにも保存する
 * (packages/core/src/domain/legacyImport/parseFamilyInfo.tsの出力をそのまま渡せる形)。
 */
export async function createCustomer(
  deps: CustomerDeps,
  input: CreateCustomerInput,
): Promise<CustomerRecord> {
  const record = await buildCustomerRecordFields(deps, input.tenantId, input);
  const created = await deps.customers.create(record);

  if (input.familyMembers && input.familyMembers.length > 0) {
    const memberInputs = await buildFamilyMemberInputs(deps, input.tenantId, created.id, input.familyMembers);
    await deps.familyMembers.createMany(memberInputs);
  }

  return created;
}

/**
 * 既存顧客を部分更新する。渡されたフィールドだけを上書きし、家族構成員は渡した場合のみ
 * 全件入れ替える(取込元の最新情報で置き換える想定のため)。
 */
export async function updateCustomer(
  deps: CustomerDeps,
  tenantId: string,
  customerId: string,
  input: CreateCustomerInput,
): Promise<CustomerRecord> {
  const record = await buildCustomerRecordFields(deps, tenantId, input);
  const patch: CustomerPatchInput = record;
  const updated = await deps.customers.update(tenantId, customerId, patch);

  if (input.familyMembers) {
    const memberInputs = await buildFamilyMemberInputs(deps, tenantId, customerId, input.familyMembers);
    await deps.familyMembers.replaceForCustomer(tenantId, customerId, memberInputs);
  }

  return updated;
}

export interface CustomerView {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
}

/**
 * 苗字(姓)の完全一致で顧客を検索する。GAS版・旧ブラインドインデックス方式と同じ「トークン単位の
 * 完全一致」の挙動を踏襲している。familyNameは平文カラムになったため技術的には前方一致(ILIKE)も
 * 実現可能だが、現時点でその要件は無いため変更していない。
 */
export async function searchCustomersByFamilyName(
  deps: CustomerDeps,
  tenantId: string,
  familyName: string,
): Promise<CustomerView[]> {
  // splitJapaneseFullName内の姓トークンと同じ正規化(NFKC + 空白除去)を検索入力にも適用する。
  // ここがずれると、登録時と検索時で一致しなくなる。
  const normalizedFamilyName = normalizeStaffName(familyName.normalize('NFKC'));
  const rows = await deps.customers.findByFamilyName(tenantId, normalizedFamilyName);

  return rows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, city: row.city }));
}

export interface CustomerListResult {
  customers: CustomerView[];
  /** 地区(市区町村)の重複無し・昇順一覧。「訪問先一覧」タブの地区絞り込みセレクトに使う。 */
  cities: string[];
}

/**
 * 有効な顧客を全件、復号した状態で返す。GAS版Main.js fetchDataFromSheetが顧客DB全件を
 * 一度にクライアントへ返し、以後の名前の部分一致検索・地区絞り込み・並び替えは全てブラウザ側の
 * 処理(index.htmlのfilterCustomers())だったのと同じ設計にするための一覧取得。
 * (searchCustomersByFamilyNameの苗字完全一致検索とは別の用途で、
 * 「訪問先一覧」タブの既定表示・絞り込みにはこちらを使う。)
 */
export async function listCustomers(deps: CustomerDeps, tenantId: string): Promise<CustomerListResult> {
  const rows = await deps.customers.listActive(tenantId);

  const customerViews = rows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, city: row.city }));

  const cities = Array.from(
    new Set(customerViews.map((c) => c.city).filter((c): c is string => Boolean(c))),
  ).sort((a, b) => a.localeCompare(b, 'ja'));

  return { customers: customerViews, cities };
}

export interface FamilyMemberView {
  id: string;
  name: string;
  dob: string | null;
  info: string | null;
}

/** 顧客の全項目(RESERVA CSV由来の全フィールド)を復号した詳細ビュー。 */
export interface CustomerDetailView {
  id: string;
  externalSource: string | null;
  externalId: string | null;
  name: string;
  familyNameKana: string | null;
  givenNameKana: string | null;
  email: string | null;
  phone: string | null;
  addressDetail: string | null;
  city: string | null;
  parkingArea: string | null;
  parkingDetail: string | null;
  emergencyContact: string | null;
  emergencyContactRelation: string | null;
  evacuationSite: string | null;
  memo: string | null;
  benefitMemberId: string | null;
  address2: string | null;
  address2StartDate: string | null;
  address2EndDate: string | null;
  latLng: string | null;
  memberType: string | null;
  memberStatus: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  gender: string | null;
  ageBracket: string | null;
  registeredAt: Date | null;
  externalLastUpdatedAt: Date | null;
  deactivatedAt: Date | null;
  familyMembers: FamilyMemberView[];
}

async function decryptFamilyMember(
  crypto: CryptoPort,
  tenantId: string,
  row: FamilyMemberRecord,
): Promise<FamilyMemberView> {
  return {
    id: row.id,
    name: await crypto.decrypt(tenantId, row.name),
    dob: await decryptIfPresent(crypto, tenantId, row.dob),
    info: await decryptIfPresent(crypto, tenantId, row.info),
  };
}

/** 顧客1件の全項目を復号し、世帯構成員一覧とあわせて返す(詳細画面用)。 */
export async function getCustomerDetail(
  deps: CustomerDeps,
  tenantId: string,
  customerId: string,
): Promise<CustomerDetailView | null> {
  const row = await deps.customers.findById(tenantId, customerId);
  if (!row) return null;

  const familyRows = await deps.familyMembers.listByCustomerId(tenantId, customerId);

  const [
    emergencyContact,
    emergencyContactRelation,
    evacuationSite,
    memo,
    benefitMemberId,
    latLng,
    familyMembers,
  ] = await Promise.all([
    decryptIfPresent(deps.crypto, tenantId, row.emergencyContact),
    decryptIfPresent(deps.crypto, tenantId, row.emergencyContactRelation),
    decryptIfPresent(deps.crypto, tenantId, row.evacuationSite),
    decryptIfPresent(deps.crypto, tenantId, row.memo),
    decryptIfPresent(deps.crypto, tenantId, row.benefitMemberId),
    decryptIfPresent(deps.crypto, tenantId, row.latLng),
    Promise.all(familyRows.map((f) => decryptFamilyMember(deps.crypto, tenantId, f))),
  ]);

  return {
    id: row.id,
    externalSource: row.externalSource,
    externalId: row.externalId,
    name: row.name,
    familyNameKana: row.familyNameKana,
    givenNameKana: row.givenNameKana,
    email: row.email,
    phone: row.phone,
    addressDetail: row.addressDetail,
    city: row.city,
    parkingArea: row.parkingArea,
    parkingDetail: row.parkingDetail,
    emergencyContact,
    emergencyContactRelation,
    evacuationSite,
    memo,
    benefitMemberId,
    address2: row.address2,
    address2StartDate: row.address2StartDate,
    address2EndDate: row.address2EndDate,
    latLng,
    memberType: row.memberType,
    memberStatus: row.memberStatus,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    gender: row.gender,
    ageBracket: row.ageBracket,
    registeredAt: row.registeredAt,
    externalLastUpdatedAt: row.externalLastUpdatedAt,
    deactivatedAt: row.deactivatedAt,
    familyMembers,
  };
}

/** 取込元に存在しなくなった顧客をソフトデリートする(物理削除はしない)。 */
export async function deactivateCustomer(
  deps: CustomerDeps,
  tenantId: string,
  customerId: string,
): Promise<void> {
  await deps.customers.deactivate(tenantId, customerId);
}
