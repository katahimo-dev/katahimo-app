import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tstzrange } from './_types';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 予定あり(busy)時間帯の出所。
 * - google_calendar: Googleカレンダーのfree/busy(またはevents)同期で取り込んだもの
 * - manual: 管理者が手入力した予定
 * - assignment: 本アプリ内の割当(reservation_assignments)から展開したもの(カレンダーへ
 *   書き戻す前の暫定表示等に使う。割当そのものの二重予約防止はreservation_assignments側のEXCLUDE制約で行う)
 */
export const BUSY_BLOCK_SOURCES = ['google_calendar', 'manual', 'assignment'] as const;
export type BusyBlockSource = (typeof BUSY_BLOCK_SOURCES)[number];

/**
 * スタッフの予定あり(busy)時間帯のキャッシュ(doc/10)。
 *
 * マッチング実行のたびにGoogle Calendar APIを全スタッフ分叩くと遅く、レート制限にも
 * かかるため、同期ジョブ(将来のworker)がここへ取り込み、マッチングはDBだけで
 * 「勤務可能時間帯 ∩ busyでない」を判定する。予定のタイトル・場所等は保存しない
 * (free/busyの判定に不要で、顧客名等の個人情報を複製しないため)。
 *
 * external_event_id はGoogleカレンダーのイベントID(free/busy APIで取得した場合はnull)。
 * 同じイベントの再同期で重複行を作らないよう、(tenant_id, staff_id, source, external_event_id)を
 * 一意にする(NULLは重複扱いされないため、manual等のID無し行は何行でも持てる)。
 */
export const staffBusyBlocks = pgTable(
  'staff_busy_blocks',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    period: tstzrange().notNull(),
    source: text({ enum: BUSY_BLOCK_SOURCES }).notNull(),
    externalEventId: text(),
    syncedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // 「このスタッフはこの時間帯に予定があるか」(period && 候補時間帯)の検索用。btree_gist拡張が必要。
    index('staff_busy_blocks_period_gist_idx').using('gist', t.tenantId, t.staffId, t.period),
    uniqueIndex('staff_busy_blocks_external_event_idx').on(
      t.tenantId,
      t.staffId,
      t.source,
      t.externalEventId,
    ),
    unique('staff_busy_blocks_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'staff_busy_blocks_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check('staff_busy_blocks_source_check', sql`${t.source} in ('google_calendar', 'manual', 'assignment')`),
    check(
      'staff_busy_blocks_period_check',
      sql`not isempty(${t.period}) and lower_inf(${t.period}) = false and upper_inf(${t.period}) = false`,
    ),
  ],
).enableRLS();

/**
 * スタッフ×カレンダーごとのGoogleカレンダー同期状態。
 *
 * sync_token はGoogle Calendar API(events.list)の増分同期トークン。トークン失効(HTTP 410)時は
 * nullに戻して全件再同期する。sync_tokenは単体ではカレンダーを読めない(OAuth/サービスアカウントの
 * 認証情報が別途必要)ため平文で保持する。認証情報そのものはここに置かない。
 */
export const calendarSyncStates = pgTable(
  'calendar_sync_states',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    calendarId: text().notNull(),
    syncToken: text(),
    lastSyncedAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('calendar_sync_states_tenant_staff_calendar_idx').on(t.tenantId, t.staffId, t.calendarId),
    unique('calendar_sync_states_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'calendar_sync_states_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
  ],
).enableRLS();
