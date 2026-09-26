import { ASSIGNMENT_STATUSES, RESERVATION_STATUSES } from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  constraintName,
  createdAt,
  idColumn,
  oneOf,
  rowVersion,
  tenantIdColumn,
  updatedAt,
} from './_columns';
import { tenantFk, tenantIsolation, tenantRef, tenantScoped } from './_helpers';
import { bytea, tstzrange } from './_types';
import { careRecipients, customerAddresses, customerRecurringSlots, customers } from './customers';
import { matchingRuns } from './matching';
import { staff } from './staff';

/** サービスの種類(テナントが定義する参照テーブル)。 */
export const serviceItems = pgTable(
  'service_items',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text().notNull(),
    name: text().notNull(),
    defaultMinutes: integer(),
    unitPriceYen: integer(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('service_items', t),
    unique('service_items_tenant_id_code_key').on(t.tenantId, t.code),
    check('service_items_default_minutes_check', sql`${t.defaultMinutes} > 0`),
    check('service_items_unit_price_yen_check', sql`${t.unitPriceYen} >= 0`),
  ],
).enableRLS();

/**
 * 予約(需要)。実績は visits に分ける(doc/10_マッチング拡張設計.md)。scheduled_period は `[開始, 終了)`、business_date は
 * テナントのタイムゾーンでの業務日。外部の予定(RESERVA 等)とは (external_source, external_id) で対応づける。
 */
export const reservations = pgTable(
  'reservations',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    customerId: uuid().notNull(),
    addressId: uuid(),
    serviceItemId: uuid(),
    recurringSlotId: uuid(),
    status: text({ enum: RESERVATION_STATUSES }).notNull().default('requested'),
    scheduledPeriod: tstzrange().notNull(),
    businessDate: date().notNull(),
    requiredStaffCount: smallint().notNull().default(1),
    notesEnc: bytea(),
    externalSource: text(),
    externalId: text(),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('reservations', t),
    tenantRef('reservations', 'customer_id', t, t.customerId, customers),
    tenantRef('reservations', 'address_id', t, t.addressId, customerAddresses),
    tenantRef('reservations', 'service_item_id', t, t.serviceItemId, serviceItems),
    tenantRef('reservations', 'recurring_slot_id', t, t.recurringSlotId, customerRecurringSlots),
    unique(constraintName('reservations', ['tenant_id', 'external_source', 'external_id'], 'key')).on(
      t.tenantId,
      t.externalSource,
      t.externalId,
    ),
    index('reservations_tenant_id_business_date_idx').on(t.tenantId, t.businessDate),
    index('reservations_tenant_id_customer_id_idx').on(t.tenantId, t.customerId),
    check('reservations_status_check', oneOf(t.status, RESERVATION_STATUSES)),
    check('reservations_required_staff_count_check', sql`${t.requiredStaffCount} >= 1`),
    check(
      'reservations_scheduled_period_check',
      sql`not isempty(${t.scheduledPeriod}) and not lower_inf(${t.scheduledPeriod}) and not upper_inf(${t.scheduledPeriod})`,
    ),
    check('reservations_external_check', sql`(${t.externalSource} is null) = (${t.externalId} is null)`),
  ],
).enableRLS();

/** 予約の対象になる子ども(1予約に複数人)。 */
export const reservationRecipients = pgTable(
  'reservation_recipients',
  {
    tenantId: tenantIdColumn(),
    reservationId: uuid().notNull(),
    careRecipientId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: 'reservation_recipients_pkey',
      columns: [t.tenantId, t.reservationId, t.careRecipientId],
    }),
    tenantFk('reservation_recipients', t),
    tenantIsolation(),
    tenantRef('reservation_recipients', 'reservation_id', t, t.reservationId, reservations, 'cascade'),
    tenantRef('reservation_recipients', 'care_recipient_id', t, t.careRecipientId, careRecipients),
  ],
).enableRLS();

/**
 * 予約へのスタッフの割当。同じスタッフの有効な割当(proposed / confirmed)の時間帯の重なりは EXCLUDE で
 * 禁止する(0001_baseline_custom.sql の reservation_assignments_tenant_id_staff_id_period_excl)。
 */
export const reservationAssignments = pgTable(
  'reservation_assignments',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    reservationId: uuid().notNull(),
    staffId: uuid().notNull(),
    period: tstzrange().notNull(),
    status: text({ enum: ASSIGNMENT_STATUSES }).notNull().default('proposed'),
    confirmedAt: timestamp({ withTimezone: true }),
    declinedAt: timestamp({ withTimezone: true }),
    matchScore: numeric({ precision: 8, scale: 3 }),
    matchReasons: jsonb().$type<Record<string, unknown>>(),
    matchingRunId: uuid(),
    assignedBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('reservation_assignments', t),
    tenantRef('reservation_assignments', 'reservation_id', t, t.reservationId, reservations, 'cascade'),
    tenantRef('reservation_assignments', 'staff_id', t, t.staffId, staff),
    tenantRef('reservation_assignments', 'matching_run_id', t, t.matchingRunId, matchingRuns),
    tenantRef('reservation_assignments', 'assigned_by', t, t.assignedBy, staff),
    index('reservation_assignments_tenant_id_reservation_id_idx').on(t.tenantId, t.reservationId),
    uniqueIndex('reservation_assignments_tenant_id_reservation_id_staff_id_key')
      .on(t.tenantId, t.reservationId, t.staffId)
      .where(sql`status in ('proposed', 'confirmed')`),
    check('reservation_assignments_status_check', oneOf(t.status, ASSIGNMENT_STATUSES)),
    check(
      'reservation_assignments_period_check',
      sql`not isempty(${t.period}) and not lower_inf(${t.period}) and not upper_inf(${t.period})`,
    ),
    check(
      'reservation_assignments_confirmed_at_check',
      sql`${t.status} <> 'confirmed' or ${t.confirmedAt} is not null`,
    ),
    check(
      'reservation_assignments_declined_at_check',
      sql`${t.status} <> 'declined' or ${t.declinedAt} is not null`,
    ),
  ],
).enableRLS();
