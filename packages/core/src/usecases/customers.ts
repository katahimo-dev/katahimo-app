import { parseLatLngText } from '@katahimo/shared';
import {
  addIsoDays,
  formatBirthDate,
  type GeoPoint,
  geoCellOf,
  newId,
  normalizeStaffName,
  notFound,
} from '../domain';
import type { CustomerSource } from '../domain/model';
import type {
  CareRecipientRecord,
  CustomerAddressRecord,
  CustomerContactRecord,
  CustomerSummary,
} from '../ports/customers';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor } from './requestMeta';

export interface CustomerDeps {
  uow: UnitOfWorkPort;
}

export interface CustomerListResult {
  customers: CustomerSummary[];
  /** 地区(市区町村)の重複無し・昇順一覧。「訪問先一覧」タブの地区絞り込みに使う。 */
  cities: string[];
}

/**
 * アーカイブされていない顧客の一覧(GAS版 Main.js fetchDataFromSheet と同じく全件を返し、名前の部分一致・
 * 地区の絞り込み・並び替えは画面で行う)。
 */
export async function listCustomers(deps: CustomerDeps, tenantId: string): Promise<CustomerListResult> {
  const customers = await deps.uow.run(tenantId, (r) => r.customers.listActiveSummaries());
  const cities = Array.from(
    new Set(customers.map((c) => c.city).filter((c): c is string => Boolean(c))),
  ).sort((a, b) => a.localeCompare(b, 'ja'));
  return { customers, cities };
}

/** 苗字(姓)の完全一致検索(NFKC・空白除去で揃えて比べる)。 */
export function searchCustomersByFamilyName(
  deps: CustomerDeps,
  tenantId: string,
  familyName: string,
): Promise<CustomerSummary[]> {
  const normalized = normalizeStaffName(familyName.normalize('NFKC'));
  return deps.uow.run(tenantId, (r) => r.customers.findByFamilyName(normalized));
}

export interface CareRecipientView {
  id: string;
  name: string;
  /** 'YYYY/M/D'(GAS版の生年月日の表記)。 */
  dob: string | null;
  /** 配慮事項・付帯情報(自由記述)。 */
  info: string | null;
  /** null の場合、画面は「アレルギー: なし」と出す(GAS版 showCustomerDetail と同じ)。 */
  allergy: string | null;
}

/** 顧客の詳細(RESERVA の顧客CSVの列の並びの画面。@katahimo/shared の customerDetailViewSchema と同じ形)。 */
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
  archivedAt: Date | null;
  familyMembers: CareRecipientView[];
}

function homeOf(addresses: CustomerAddressRecord[]): CustomerAddressRecord | undefined {
  return addresses.find((a) => a.kind === 'home' && a.isPrimary) ?? addresses.find((a) => a.kind === 'home');
}

/**
 * 顧客1件の全項目(子ども・アレルギー・緊急連絡先を含む)を返す(読み出しは1トランザクション)。無ければ
 * not_found。閲覧の記録(customer.detail.viewed)は API のルートが残す。
 */
export async function getCustomerDetail(
  deps: CustomerDeps,
  actor: Actor,
  customerId: string,
): Promise<CustomerDetailView> {
  const loaded = await deps.uow.run(actor.tenantId, async (r) => {
    const customer = await r.customers.findById(customerId);
    if (!customer) return null;
    const [source, addresses, contacts, recipients] = await Promise.all([
      r.customerSourceRecords.findByCustomerId(customerId),
      r.customerAddresses.listByCustomer(customerId),
      r.customerContacts.listByCustomer(customerId),
      r.careRecipients.listByCustomer(customerId),
    ]);
    return { customer, source, addresses, contacts, recipients };
  });
  if (!loaded) throw notFound('顧客が見つかりません');
  const { customer, source, addresses, contacts, recipients } = loaded;
  const home = homeOf(addresses);
  const secondary = addresses.find((a) => a.kind === 'secondary');
  const emergency = contacts.find((c) => c.isEmergency);
  const attr = (key: string) => source?.attributes[key] ?? null;

  const view: CustomerDetailView = {
    id: customer.id,
    externalSource: source?.source ?? null,
    externalId: source?.externalId ?? null,
    name: customer.displayName,
    familyNameKana: customer.familyNameKana,
    givenNameKana: customer.givenNameKana,
    email: customer.email,
    phone: customer.phone,
    addressDetail: home?.addressLine ?? null,
    city: home?.city ?? null,
    parkingArea: home?.parkingArea ?? null,
    parkingDetail: home?.parkingDetail ?? null,
    emergencyContact: emergency?.phone ?? null,
    emergencyContactRelation: emergency?.relation ?? null,
    evacuationSite: customer.evacuationSite,
    memo: customer.memo,
    benefitMemberId: customer.benefitMemberId,
    address2: secondary?.addressLine ?? null,
    address2StartDate: secondary?.valid.start ?? null,
    address2EndDate: secondary?.valid.end ? addIsoDays(secondary.valid.end, -1) : null,
    // GAS版と同じく取込元の表記のまま出す
    latLng: home?.latLngText ?? null,
    memberType: attr('member_type'),
    memberStatus: attr('member_status'),
    paymentMethod: attr('payment_method'),
    paymentStatus: attr('payment_status'),
    gender: attr('gender'),
    ageBracket: attr('age_bracket'),
    registeredAt: source?.externalRegisteredAt ?? null,
    externalLastUpdatedAt: source?.externalUpdatedAt ?? null,
    archivedAt: customer.archivedAt,
    familyMembers: recipients.map((c) => ({
      id: c.id,
      name: c.name,
      dob: formatBirthDate(c.birthDate),
      info: c.needs,
      allergy: c.allergy,
    })),
  };
  return view;
}

// ─────────────────────────────────────────────────────────────
// 取込元のデータで顧客を揃える(RESERVA の顧客CSV等。差分で適用し、ID を保つ)
// ─────────────────────────────────────────────────────────────

export interface CustomerSnapshotAddress {
  addressLine: string;
  prefecture?: string | null;
  city?: string | null;
  parkingArea?: string | null;
  parkingDetail?: string | null;
  /** 取込元の「緯度・経度」の表記(表記はそのまま残し、読めなければ緯度経度なしとして持つ。@katahimo/shared parseLatLngText)。 */
  latLng?: string | null;
}

export interface CustomerSnapshotRecipient {
  name: string;
  /** 'YYYY-MM-DD'。 */
  birthDate: string | null;
  needs?: string | null;
  allergy?: string | null;
}

/**
 * 取込元の1顧客分(取込元の形式を知らない形)。顧客CSVは全ての項目を持つ(1行が顧客の今の全ての値)。
 * 外部連携の API は項目を省けるため、省ける項目は undefined を許す(扱いは ApplyContext.omitted)。
 */
export interface CustomerSnapshot {
  source: CustomerSource;
  externalId: string;
  /** 表示名。null・空は「姓 名」。 */
  displayName?: string | null | undefined;
  familyName: string;
  givenName?: string | undefined;
  familyNameKana?: string | null | undefined;
  givenNameKana?: string | null | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  memo?: string | null | undefined;
  benefitMemberId?: string | null | undefined;
  evacuationSite?: string | null | undefined;
  /** 取込元固有の分類値(会員種別・会費の支払方法等。個人を特定しない値だけ)。 */
  attributes?: Record<string, string> | undefined;
  externalRegisteredAt?: Date | null | undefined;
  externalUpdatedAt?: Date | null | undefined;
  home?: CustomerSnapshotAddress | null | undefined;
  /** 期間限定の住所(GAS版の住所2)。validFrom / validTo は両端を含む 'YYYY-MM-DD'。 */
  secondary?:
    | (CustomerSnapshotAddress & { validFrom: string | null; validTo: string | null })
    | null
    | undefined;
  emergencyContact?: { relation?: string | null; phone?: string | null } | null | undefined;
  /** 子どもの全員(配列で渡すと、その並びに揃える)。 */
  recipients?: CustomerSnapshotRecipient[] | undefined;
}

export type SnapshotOutcome = 'created' | 'updated' | 'unchanged' | 'skipped';

/**
 * 取込元の値の誤り(行の取込は止めずに直す・その行だけ飛ばす)。import_runs.counts.issues に数を残す。
 * - secondary_period_inverted: 住所2の適用終了日が開始日より前(期間なしとして持つ。GAS版はこの住所を使わなかった)
 * - invalid_timestamp: 取込元の登録日時・更新日時が読めない(null にする)
 * - missing_external_id / missing_name: 取込元のID・氏名が無い(その行を取り込まない)
 */
export type CustomerSnapshotIssue =
  | 'secondary_period_inverted'
  | 'invalid_timestamp'
  | 'missing_external_id'
  | 'missing_name';

/**
 * 省いた(undefined の)項目の扱い。
 * - clear(既定): 空にする(顧客CSV。1行が顧客の今の全ての値で、どの列も必ずある)。
 * - keep: 今の値のまま(外部連携の API の部分的な送信)。null は空にする。新しい顧客では省いた項目は空。
 *   住所・住所2・緊急連絡先はまとまりごと(渡せばまとまりの全ての値を置き換える)、子どもは配列ごと(渡せば全員を置き換える)。
 */
export type OmittedFieldPolicy = 'clear' | 'keep';

export interface ApplyContext {
  runId: string | null;
  /** 取込元の値の誤りを見つけたとき(取込の集計に使う)。 */
  onIssue?: (issue: CustomerSnapshotIssue) => void;
  /** 省いた項目の扱い(既定は clear)。 */
  omitted?: OmittedFieldPolicy;
}

const validDate = (value: Date | null | undefined): Date | null =>
  value && !Number.isNaN(value.getTime()) ? value : null;

/**
 * 取込元の1顧客分を、DB に書ける形に直す(書く前に確かめ、DB の制約でトランザクション全体を失敗させない)。
 * 取り込めない行は null(理由は issues)。
 */
export function normalizeCustomerSnapshot(snapshot: CustomerSnapshot): {
  snapshot: CustomerSnapshot | null;
  issues: CustomerSnapshotIssue[];
} {
  const issues: CustomerSnapshotIssue[] = [];
  if (!snapshot.externalId.trim()) return { snapshot: null, issues: ['missing_external_id'] };
  if (!snapshot.displayName?.trim() && !snapshot.familyName.trim())
    return { snapshot: null, issues: ['missing_name'] };
  let secondary = snapshot.secondary;
  if (secondary?.validFrom && secondary.validTo && secondary.validTo < secondary.validFrom) {
    issues.push('secondary_period_inverted');
    secondary = { ...secondary, validFrom: null, validTo: null };
  }
  // 省いた(undefined)日時は省いたまま(ApplyContext.omitted が keep なら今の値を使う)
  const externalRegisteredAt =
    snapshot.externalRegisteredAt === undefined ? undefined : validDate(snapshot.externalRegisteredAt);
  const externalUpdatedAt =
    snapshot.externalUpdatedAt === undefined ? undefined : validDate(snapshot.externalUpdatedAt);
  if (
    (snapshot.externalRegisteredAt && !externalRegisteredAt) ||
    (snapshot.externalUpdatedAt && !externalUpdatedAt)
  ) {
    issues.push('invalid_timestamp');
  }
  return { snapshot: { ...snapshot, secondary, externalRegisteredAt, externalUpdatedAt }, issues };
}

function same(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/** 属性(jsonb)を比べる。jsonb はキーの順番を保たないため、並べ替えてから比べる。 */
function sameAttributes(a: Record<string, string>, b: Record<string, string>): boolean {
  const sorted = (v: Record<string, string>) =>
    JSON.stringify(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)));
  return sorted(a) === sorted(b);
}

/** 自由記述の取込値(空文字は null として持つ)。 */
function textOrNull(value: string | null | undefined): string | null {
  return value || null;
}

function sameGeo(a: GeoPoint | null, b: GeoPoint | null): boolean {
  return a === null || b === null ? a === b : a.lat === b.lat && a.lng === b.lng;
}

async function syncAddress(
  r: TenantRepositories,
  customerId: string,
  kind: 'home' | 'secondary',
  existing: CustomerAddressRecord | undefined,
  next: (CustomerSnapshotAddress & { validFrom?: string | null; validTo?: string | null }) | null,
): Promise<boolean> {
  if (!next?.addressLine) {
    if (!existing) return false;
    await r.customerAddresses.delete(existing.id);
    return true;
  }
  const id = existing?.id ?? newId();
  const geo = parseLatLngText(next.latLng);
  const latLngText = next.latLng?.trim() || null;
  const valid = {
    start: next.validFrom ?? null,
    end: next.validTo ? addIsoDays(next.validTo, 1) : null,
  };
  const fields = {
    kind,
    postalCode: null,
    prefecture: next.prefecture ?? null,
    city: next.city ?? null,
    addressLine: next.addressLine,
    building: null,
    parkingArea: next.parkingArea ?? null,
    parkingDetail: next.parkingDetail ?? null,
    geo,
    latLngText,
    geoCell: geoCellOf(geo),
    valid,
    isPrimary: kind === 'home',
  };
  if (!existing) {
    await r.customerAddresses.insert({ id, customerId, ...fields });
    return true;
  }
  const changed =
    !sameGeo(existing.geo, geo) ||
    !same(existing.latLngText, latLngText) ||
    !same(existing.prefecture, fields.prefecture) ||
    !same(existing.city, fields.city) ||
    existing.addressLine !== fields.addressLine ||
    !same(existing.parkingArea, fields.parkingArea) ||
    !same(existing.parkingDetail, fields.parkingDetail) ||
    !same(existing.valid.start, valid.start) ||
    !same(existing.valid.end, valid.end);
  if (changed) await r.customerAddresses.update(id, fields);
  return changed;
}

async function syncEmergencyContact(
  r: TenantRepositories,
  customerId: string,
  existing: CustomerContactRecord | undefined,
  next: CustomerSnapshot['emergencyContact'],
): Promise<boolean> {
  if (!next?.phone && !next?.relation) {
    if (!existing) return false;
    await r.customerContacts.delete(existing.id);
    return true;
  }
  const phone = textOrNull(next.phone);
  if (!existing) {
    await r.customerContacts.insert({
      id: newId(),
      customerId,
      relation: next.relation ?? null,
      name: null,
      phone,
      notes: null,
      isEmergency: true,
      sortOrder: 0,
    });
    return true;
  }
  const changed = !same(existing.phone, phone) || !same(existing.relation, next.relation);
  if (changed) await r.customerContacts.update(existing.id, { relation: next.relation ?? null, phone });
  return changed;
}

/**
 * 子どもを差分で揃える: 氏名(空白を除いた表記)で突き合わせ、変わった項目だけを書き、取込元から消えた子どもは
 * archived_at を付ける(ID を保つ。消して作り直さない)。同じ名前が複数いる場合は並び順で対応づける。
 */
async function syncRecipients(
  r: TenantRepositories,
  customerId: string,
  next: CustomerSnapshotRecipient[],
  now: Date,
): Promise<boolean> {
  const existing = await r.careRecipients.listByCustomer(customerId, { includeArchived: true });
  const pool = new Map<string, CareRecipientRecord[]>();
  for (const e of existing) {
    const key = normalizeStaffName(e.name);
    pool.set(key, [...(pool.get(key) ?? []), e]);
  }
  let changed = false;
  const kept = new Set<string>();
  for (const [index, recipient] of next.entries()) {
    const match = pool.get(normalizeStaffName(recipient.name))?.shift();
    const id = match?.id ?? newId();
    kept.add(id);
    const allergy = textOrNull(recipient.allergy);
    const needs = textOrNull(recipient.needs);
    if (!match) {
      await r.careRecipients.insert({
        id,
        customerId,
        name: recipient.name,
        nameKana: null,
        birthDate: recipient.birthDate,
        sex: null,
        allergy,
        needs,
        sortOrder: index,
      });
      changed = true;
      continue;
    }
    if (
      !same(match.allergy, allergy) ||
      !same(match.needs, needs) ||
      match.name !== recipient.name ||
      !same(match.birthDate, recipient.birthDate) ||
      match.sortOrder !== index ||
      match.archivedAt !== null
    ) {
      await r.careRecipients.update(id, {
        name: recipient.name,
        birthDate: recipient.birthDate,
        allergy,
        needs,
        sortOrder: index,
        archivedAt: null,
      });
      changed = true;
    }
  }
  for (const e of existing) {
    if (!kept.has(e.id) && e.archivedAt === null) {
      await r.careRecipients.update(e.id, { archivedAt: now });
      changed = true;
    }
  }
  return changed;
}

/**
 * 取込元の1顧客分を DB に揃える(UoW のトランザクションの中で呼ぶ)。取込元の ID(source, external_id)で
 * 突き合わせ、無ければ作り、あれば変わった項目だけを書く。アーカイブ済みの顧客が取込元に戻ったら戻す。
 * 取込元の値の誤りは書く前に直し(normalizeCustomerSnapshot)、直せない行は書かずに skipped を返す
 * (1行の誤りで取込全体を失敗させない)。省いた項目の扱いは ctx.omitted(顧客CSVは clear、外部連携の API は keep)。
 * 同じテナントの取込が同時に走ると同じ顧客を2人作りうるため、呼ぶ側は先に r.importRuns.lockTenantCustomerImports() を取る。
 */
export async function applyCustomerSnapshot(
  ctx: ApplyContext,
  r: TenantRepositories,
  input: CustomerSnapshot,
  now: Date,
): Promise<SnapshotOutcome> {
  const normalized = normalizeCustomerSnapshot(input);
  for (const issue of normalized.issues) ctx.onIssue?.(issue);
  const snapshot = normalized.snapshot;
  if (!snapshot) return 'skipped';
  const keep = ctx.omitted === 'keep';
  const linked = await r.customerSourceRecords.findByExternalId(snapshot.source, snapshot.externalId);
  const current = linked ? await r.customers.findById(linked.customerId) : null;
  const customerId = current?.id ?? newId();
  /** 省いた項目: keep なら今の値、それ以外(clear・新しい顧客)は空。 */
  const orCurrent = <T>(value: T | undefined, existing: T | undefined, empty: T): T =>
    value !== undefined ? value : keep && existing !== undefined ? existing : empty;
  const familyName = normalizeStaffName(snapshot.familyName);
  const givenName = normalizeStaffName(orCurrent(snapshot.givenName, current?.givenName, ''));
  const displayName =
    snapshot.displayName === undefined && keep && current
      ? current.displayName
      : snapshot.displayName || `${snapshot.familyName} ${snapshot.givenName ?? givenName}`.trim();
  const fields = {
    displayName,
    familyName,
    givenName,
    familyNameKana: orCurrent(snapshot.familyNameKana, current?.familyNameKana, null),
    givenNameKana: orCurrent(snapshot.givenNameKana, current?.givenNameKana, null),
    email: orCurrent(snapshot.email, current?.email, null),
    phone: orCurrent(snapshot.phone, current?.phone, null),
    memo: textOrNull(orCurrent(snapshot.memo, current?.memo, null)),
    benefitMemberId: textOrNull(orCurrent(snapshot.benefitMemberId, current?.benefitMemberId, null)),
    evacuationSite: textOrNull(orCurrent(snapshot.evacuationSite, current?.evacuationSite, null)),
  };

  let changed = false;
  if (!current) {
    await r.customers.create({ id: customerId, ...fields });
    changed = true;
  } else {
    const customerChanged = (
      [
        'displayName',
        'familyName',
        'givenName',
        'familyNameKana',
        'givenNameKana',
        'email',
        'phone',
        'memo',
        'benefitMemberId',
        'evacuationSite',
      ] as const
    ).some((k) => !same(current[k], fields[k]));
    if (customerChanged) await r.customers.update(customerId, fields);
    if (current.archivedAt) await r.customers.unarchive(customerId);
    changed = customerChanged || current.archivedAt !== null;
  }

  const attributes = orCurrent(snapshot.attributes, linked?.attributes, {});
  const externalRegisteredAt = orCurrent(snapshot.externalRegisteredAt, linked?.externalRegisteredAt, null);
  const externalUpdatedAt = orCurrent(snapshot.externalUpdatedAt, linked?.externalUpdatedAt, null);
  await r.customerSourceRecords.upsert({
    id: linked?.id ?? newId(),
    customerId,
    source: snapshot.source,
    externalId: snapshot.externalId,
    attributes,
    externalRegisteredAt,
    externalUpdatedAt,
    lastImportRunId: ctx.runId,
  });
  const sourceChanged =
    !linked ||
    !sameAttributes(linked.attributes, attributes) ||
    linked.externalUpdatedAt?.getTime() !== externalUpdatedAt?.getTime();

  // keep で省いたまとまり(住所・住所2・緊急連絡先・子ども)は触らない
  const skip = (value: unknown) => keep && value === undefined;
  const addresses = current ? await r.customerAddresses.listByCustomer(customerId) : [];
  const contacts =
    current && !skip(snapshot.emergencyContact) ? await r.customerContacts.listByCustomer(customerId) : [];
  const results = [
    skip(snapshot.home)
      ? false
      : await syncAddress(r, customerId, 'home', homeOf(addresses), snapshot.home ?? null),
    skip(snapshot.secondary)
      ? false
      : await syncAddress(
          r,
          customerId,
          'secondary',
          addresses.find((a) => a.kind === 'secondary'),
          snapshot.secondary ?? null,
        ),
    skip(snapshot.emergencyContact)
      ? false
      : await syncEmergencyContact(
          r,
          customerId,
          contacts.find((c) => c.isEmergency),
          snapshot.emergencyContact ?? null,
        ),
    skip(snapshot.recipients) ? false : await syncRecipients(r, customerId, snapshot.recipients ?? [], now),
  ];
  if (!current) return 'created';
  return changed || sourceChanged || results.some(Boolean) ? 'updated' : 'unchanged';
}
