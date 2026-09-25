import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * テナント(法人)。マルチテナントSaaSの分離単位。
 * このテーブル自体はRLS対象外(未認証のログイン画面が、どのテナントか特定する前段で
 * 読む必要があるため)。
 *
 * ログインは `slug` (例: URLの一部やログイン画面での法人選択に使う短い識別子)を手がかりに
 * テナントを特定してから、そのテナントIDでRLSスコープ内のstaffを検索する2段階方式にする。
 * こうしないと「メールアドレスだけで全テナント横断のstaffを検索する」処理が必要になり、
 * RLSによるテナント分離の効果が薄れてしまう。
 *
 * 【複数法人・業種拡張(doc/10)】status/timezone/businessTypeは2026-09に追加。
 * - status: 'suspended'のテナントはログイン・API利用を止める想定(判定はアプリ層で行う)。
 * - timezone: 業務日(business_date)の境界や勤務可能時間帯(staff_weekly_availability)を
 *   解釈するIANAタイムゾーン。現状の全テナントは'Asia/Tokyo'。
 * - businessType: 業種('babysitting'=ベビーシッター/家事支援、将来'home_nursing'=訪問看護等)。
 *   業種ごとにスキーマを分岐させず、機能差はtenant_features(機能フラグ)で吸収する(doc/07 第4.2節)。
 *   将来の業種を追加するたびにマイグレーションが要らないよう、CHECK制約は付けない。
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    name: text().notNull(),
    slug: text().notNull(),
    status: text({ enum: ['active', 'suspended'] })
      .notNull()
      .default('active'),
    timezone: text().notNull().default('Asia/Tokyo'),
    businessType: text().notNull().default('babysitting'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tenants_slug_idx').on(t.slug),
    check('tenants_status_check', sql`${t.status} in ('active', 'suspended')`),
  ],
);
