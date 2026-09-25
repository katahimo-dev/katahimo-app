import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * テナント(法人)。マルチテナントSaaSの分離単位。
 * このテーブル自体はRLS対象外(未認証のログイン画面が、どのテナントか特定する前段で
 * 読む必要があるため)。
 *
 * ログインは `slug` (例: URLの一部やログイン画面での法人選択に使う短い識別子)を手がかりに
 * テナントを特定してから、そのテナントIDでRLSスコープ内のstaffを検索する2段階方式にする。
 * こうしないと「メールアドレスだけで全テナント横断のstaffを検索する」処理が必要になり、
 * RLSによるテナント分離の効果が薄れてしまう。
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    name: text().notNull(),
    slug: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tenants_slug_idx').on(t.slug)],
);
