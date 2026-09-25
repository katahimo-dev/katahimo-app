import {
  addIsoDays,
  formatBirthDate,
  geoCellOf,
  newId,
  normalizeStaffName,
  notFound,
  ENCRYPTION_PURPOSES as P,
} from '../domain';
import type { CustomerSource } from '../domain/model';
import type { AuditLogPort, CryptoPort } from '../ports/crypto';
import type {
  CareRecipientRecord,
  CustomerAddressRecord,
  CustomerContactRecord,
  CustomerSummary,
} from '../ports/customers';
import type { TenantRepositories, UnitOfWorkPort } from '../ports/unitOfWork';
import { DecryptSession, encryptOptional } from './cipher';
import type { Actor } from './requestMeta';

export interface CustomerDeps {
  uow: UnitOfWorkPort;
  crypto: CryptoPort;
  audit?: AuditLogPort;
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
 * 顧客1件の全項目(子ども・アレルギー・緊急連絡先を含む)を復号して返す(読み出しは1トランザクション、
 * 復号の監査は1件)。無ければ not_found。
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
  const d = new DecryptSession(deps.crypto, actor.tenantId);
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
    emergencyContact: emergency
      ? await d.optional(P.customerContactPhone, emergency.id, emergency.phoneEnc)
      : null,
    emergencyContactRelation: emergency?.relation ?? null,
    evacuationSite: await d.optional(P.customerEvacuationSite, customer.id, customer.evacuationSiteEnc),
    memo: await d.optional(P.customerMemo, customer.id, customer.memoEnc),
    benefitMemberId: await d.optional(P.customerBenefitMemberId, customer.id, customer.benefitMemberIdEnc),
    address2: secondary?.addressLine ?? null,
    address2StartDate: secondary?.valid.start ?? null,
    address2EndDate: secondary?.valid.end ? addIsoDays(secondary.valid.end, -1) : null,
    latLng: home ? await d.optional(P.customerAddressGeo, home.id, home.geoEnc) : null,
    memberType: attr('member_type'),
    memberStatus: attr('member_status'),
    paymentMethod: attr('payment_method'),
    paymentStatus: attr('payment_status'),
    gender: attr('gender'),
    ageBracket: attr('age_bracket'),
    registeredAt: source?.externalRegisteredAt ?? null,
    externalLastUpdatedAt: source?.externalUpdatedAt ?? null,
    archivedAt: customer.archivedAt,
    familyMembers: await Promise.all(
      recipients.map(async (c) => ({
        id: c.id,
        name: c.name,
        dob: formatBirthDate(c.birthDate),
        info: await d.optional(P.careRecipientNeeds, c.id, c.needsEnc),
        allergy: await d.optional(P.careRecipientAllergy, c.id, c.allergyEnc),
      })),
    ),
  };
  d.flush(deps.audit, 'customer.detail', actor.staffId);
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
  /** 'lat,lng'(暗号化して保存し、粗い区画だけを平文にする)。 */
  latLng?: string | null;
}

export interface CustomerSnapshotRecipient {
  name: string;
  /** 'YYYY-MM-DD'。 */
  birthDate: string | null;
  needs?: string | null;
  allergy?: string | null;
}

/** 取込元の1顧客分(取込元の形式を知らない形)。 */
export interface CustomerSnapshot {
  source: CustomerSource;
  externalId: string;
  displayName: string;
  familyName: string;
  givenName: string;
  familyNameKana?: string | null;
  givenNameKana?: string | null;
  email?: string | null;
  phone?: string | null;
  memo?: string | null;
  benefitMemberId?: string | null;
  evacuationSite?: string | null;
  /** 取込元固有の分類値(会員種別・会費の支払方法等。個人を特定しない値だけ)。 */
  attributes: Record<string, string>;
  externalRegisteredAt?: Date | null;
  externalUpdatedAt?: Date | null;
  home: CustomerSnapshotAddress | null;
  /** 期間限定の住所(GAS版の住所2)。validFrom / validTo は両端を含む 'YYYY-MM-DD'。 */
  secondary: (CustomerSnapshotAddress & { validFrom: string | null; validTo: string | null }) | null;
  emergencyContact: { relation?: string | null; phone?: string | null } | null;
  recipients: CustomerSnapshotRecipient[];
}

export type SnapshotOutcome = 'created' | 'updated' | 'unchanged';

interface ApplyContext {
  crypto: CryptoPort;
  runId: string | null;
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

/** 暗号化列を比べる(平文で比べ、変わっていれば新しい暗号文)。 */
async function encryptedDiff(
  ctx: ApplyContext,
  r: TenantRepositories,
  purpose: (typeof P)[keyof typeof P],
  rowId: string,
  current: Uint8Array | null,
  next: string | null | undefined,
): Promise<{ changed: boolean; value: Uint8Array | null }> {
  const currentText = current
    ? await ctx.crypto.decrypt({ tenantId: r.tenantId, purpose, rowId }, current)
    : null;
  if (same(currentText, next || null)) return { changed: false, value: current };
  return { changed: true, value: await encryptOptional(ctx.crypto, r.tenantId, purpose, rowId, next) };
}

async function syncAddress(
  ctx: ApplyContext,
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
  const geo = await encryptedDiff(ctx, r, P.customerAddressGeo, id, existing?.geoEnc ?? null, next.latLng);
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
    geoEnc: geo.value,
    geoCell: geoCellOf(next.latLng),
    valid,
    isPrimary: kind === 'home',
  };
  if (!existing) {
    await r.customerAddresses.insert({ id, customerId, ...fields });
    return true;
  }
  const changed =
    geo.changed ||
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
  ctx: ApplyContext,
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
  const id = existing?.id ?? newId();
  const phone = await encryptedDiff(
    ctx,
    r,
    P.customerContactPhone,
    id,
    existing?.phoneEnc ?? null,
    next.phone,
  );
  if (!existing) {
    await r.customerContacts.insert({
      id,
      customerId,
      relation: next.relation ?? null,
      nameEnc: null,
      phoneEnc: phone.value,
      notesEnc: null,
      isEmergency: true,
      sortOrder: 0,
    });
    return true;
  }
  const changed = phone.changed || !same(existing.relation, next.relation);
  if (changed)
    await r.customerContacts.update(id, { relation: next.relation ?? null, phoneEnc: phone.value });
  return changed;
}

/**
 * 子どもを差分で揃える: 氏名(空白を除いた表記)で突き合わせ、変わった項目だけを書き、取込元から消えた子どもは
 * archived_at を付ける(ID を保つ。消して作り直さない)。同じ名前が複数いる場合は並び順で対応づける。
 */
async function syncRecipients(
  ctx: ApplyContext,
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
    const allergy = await encryptedDiff(
      ctx,
      r,
      P.careRecipientAllergy,
      id,
      match?.allergyEnc ?? null,
      recipient.allergy,
    );
    const needs = await encryptedDiff(
      ctx,
      r,
      P.careRecipientNeeds,
      id,
      match?.needsEnc ?? null,
      recipient.needs,
    );
    if (!match) {
      await r.careRecipients.insert({
        id,
        customerId,
        name: recipient.name,
        nameKana: null,
        birthDate: recipient.birthDate,
        sex: null,
        allergyEnc: allergy.value,
        needsEnc: needs.value,
        sortOrder: index,
      });
      changed = true;
      continue;
    }
    if (
      allergy.changed ||
      needs.changed ||
      match.name !== recipient.name ||
      !same(match.birthDate, recipient.birthDate) ||
      match.sortOrder !== index ||
      match.archivedAt !== null
    ) {
      await r.careRecipients.update(id, {
        name: recipient.name,
        birthDate: recipient.birthDate,
        allergyEnc: allergy.value,
        needsEnc: needs.value,
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
 */
export async function applyCustomerSnapshot(
  ctx: ApplyContext,
  r: TenantRepositories,
  snapshot: CustomerSnapshot,
  now: Date,
): Promise<SnapshotOutcome> {
  const linked = await r.customerSourceRecords.findByExternalId(snapshot.source, snapshot.externalId);
  const current = linked ? await r.customers.findById(linked.customerId) : null;
  const customerId = current?.id ?? newId();
  const encrypted = {
    memo: await encryptedDiff(ctx, r, P.customerMemo, customerId, current?.memoEnc ?? null, snapshot.memo),
    benefit: await encryptedDiff(
      ctx,
      r,
      P.customerBenefitMemberId,
      customerId,
      current?.benefitMemberIdEnc ?? null,
      snapshot.benefitMemberId,
    ),
    evacuation: await encryptedDiff(
      ctx,
      r,
      P.customerEvacuationSite,
      customerId,
      current?.evacuationSiteEnc ?? null,
      snapshot.evacuationSite,
    ),
  };
  const fields = {
    displayName: snapshot.displayName,
    familyName: normalizeStaffName(snapshot.familyName),
    givenName: normalizeStaffName(snapshot.givenName),
    familyNameKana: snapshot.familyNameKana ?? null,
    givenNameKana: snapshot.givenNameKana ?? null,
    email: snapshot.email ?? null,
    phone: snapshot.phone ?? null,
    memoEnc: encrypted.memo.value,
    benefitMemberIdEnc: encrypted.benefit.value,
    evacuationSiteEnc: encrypted.evacuation.value,
  };

  let changed = false;
  if (!current) {
    await r.customers.create({ id: customerId, ...fields });
    changed = true;
  } else {
    const customerChanged =
      encrypted.memo.changed ||
      encrypted.benefit.changed ||
      encrypted.evacuation.changed ||
      (
        [
          'displayName',
          'familyName',
          'givenName',
          'familyNameKana',
          'givenNameKana',
          'email',
          'phone',
        ] as const
      ).some((k) => !same(current[k], fields[k]));
    if (customerChanged) await r.customers.update(customerId, fields);
    if (current.archivedAt) await r.customers.unarchive(customerId);
    changed = customerChanged || current.archivedAt !== null;
  }

  await r.customerSourceRecords.upsert({
    id: linked?.id ?? newId(),
    customerId,
    source: snapshot.source,
    externalId: snapshot.externalId,
    attributes: snapshot.attributes,
    externalRegisteredAt: snapshot.externalRegisteredAt ?? null,
    externalUpdatedAt: snapshot.externalUpdatedAt ?? null,
    lastImportRunId: ctx.runId,
  });
  const sourceChanged =
    !linked ||
    !sameAttributes(linked.attributes, snapshot.attributes) ||
    linked.externalUpdatedAt?.getTime() !== (snapshot.externalUpdatedAt ?? null)?.getTime();

  const addresses = current ? await r.customerAddresses.listByCustomer(customerId) : [];
  const contacts = current ? await r.customerContacts.listByCustomer(customerId) : [];
  const results = [
    await syncAddress(ctx, r, customerId, 'home', homeOf(addresses), snapshot.home),
    await syncAddress(
      ctx,
      r,
      customerId,
      'secondary',
      addresses.find((a) => a.kind === 'secondary'),
      snapshot.secondary,
    ),
    await syncEmergencyContact(
      ctx,
      r,
      customerId,
      contacts.find((c) => c.isEmergency),
      snapshot.emergencyContact,
    ),
    await syncRecipients(ctx, r, customerId, snapshot.recipients, now),
  ];
  if (!current) return 'created';
  return changed || sourceChanged || results.some(Boolean) ? 'updated' : 'unchanged';
}
