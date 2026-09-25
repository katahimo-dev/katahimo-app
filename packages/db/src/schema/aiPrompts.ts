import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 管理者が画面から編集できるAIプロンプトと入力欄プレースホルダー(GAS版の「プロンプト」シート/
 * Script Propertiesに相当)。
 *
 * - kind='prompt': 日報・事故報告生成、領収書OCR等でGeminiに渡すプロンプト本文。
 * - kind='placeholder': 日報入力欄等に表示するプレースホルダー(記入例)。
 * key は用途を表す安定した識別子(例: 'daily_report.internal'、'daily_report.memo_placeholder')。
 * 行が無いkeyはコード側の既定値を使う。プロンプトは業務ノウハウであり個人情報を含まない前提の
 * ため平文で保存する(顧客情報を埋め込んだ例文を書かない運用とする)。
 */
export const aiPrompts = pgTable(
  'ai_prompts',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    kind: text({ enum: ['prompt', 'placeholder'] })
      .notNull()
      .default('prompt'),
    key: text().notNull(),
    body: text().notNull(),
    /** 最後に編集した管理者。シード投入した初期値はnull。 */
    updatedByStaffId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('ai_prompts_tenant_key_idx').on(t.tenantId, t.key),
    unique('ai_prompts_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'ai_prompts_tenant_updated_by_fk',
      columns: [t.tenantId, t.updatedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check('ai_prompts_kind_check', sql`${t.kind} in ('prompt', 'placeholder')`),
  ],
).enableRLS();
