import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * パスワード再設定用の確認コード(GAS版のパスワードリセット機能に相当)。
 *
 * - code_hash: メールで送った確認コードのハッシュ(SHA-256等)。生のコードはメール本文にしか存在しない
 *   (sessions.token_hashと同じ考え方)。
 * - sent_to_email: 送信先(email/alt_emailのどちらに送ったか)。正規化済みの平文。
 * - attempt_count: 誤入力回数。上限を超えたコードは無効とする(総当たり対策、判定はusecase側)。
 * - used_at: 使用済み日時。使用済み・期限切れ(expires_at <= now())のコードは受け付けない。
 * 発行時は同じスタッフの未使用コードを無効化(used_atを設定)してから新しい行を作る運用とする。
 */
export const passwordResetCodes = pgTable(
  'password_reset_codes',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    codeHash: text().notNull(),
    sentToEmail: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    attemptCount: integer().notNull().default(0),
    mailCodeCiphertext: text(),
    mailCodeKeyVersion: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    index('password_reset_codes_tenant_staff_idx').on(t.tenantId, t.staffId, t.createdAt),
    unique('password_reset_codes_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'password_reset_codes_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check('password_reset_codes_attempt_count_check', sql`${t.attemptCount} >= 0`),
  ],
).enableRLS();
