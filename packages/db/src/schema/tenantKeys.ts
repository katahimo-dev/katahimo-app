import { integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * テナントごとのデータ暗号化鍵(DEK)。エンベロープ暗号化の要。
 *
 * 実データ列(*_ciphertext)を直接暗号化する鍵は、マスターキーからの決定的導出(旧実装、
 * 2026-08 データベース構造レビューで指摘)ではなく、テナントごとにランダム生成した
 * DEKそのものを使う。DEKは平文のままでは保存せず、KEK(Key Encryption Key。ローカル開発は
 * 環境変数、本番はCloud KMS想定)でラップ(暗号化)した状態でのみ永続化する
 * (packages/core/src/ports/kms.ts のKeyManagementPort参照)。
 *
 * こうする理由: 旧実装(SHA256(masterKey + tenantId))は「masterKeyが割れれば任意テナントの鍵を
 * 誰でも計算できる」という、キー1本を共有しているのと実質的に変わらない設計だった。
 * DEKをテナントごとに独立して生成・保管することで、
 * - KEKが漏洩しても、攻撃者は「ラップされたDEKの実体」まで別途盗む必要がある(単一の
 *   決定的関数だけでは全テナントの鍵を再現できない)
 * - テナント解約時は本レコードを削除するだけで、そのテナントの暗号文はバックアップに
 *   残っていても二度と復号できなくなる(暗号学的削除。revoke()参照)
 * - 本番のCloud KMS移行時は、KeyManagementPortの実装を差し替えるだけで済む(wrappedDek列の
 *   形式(base64)自体は変えずに済む)
 * が実現できる。
 *
 * dekVersion: DEKそのものをローテーションした回数(実データの再暗号化を伴う、重い操作)。
 * 各暗号化列の`*_key_version`はこの値を指す。
 * kekVersion: DEKを再ラップした回数(KEKだけを差し替える、軽い操作。データの再暗号化は不要)。
 */
export const tenantKeys = pgTable(
  'tenant_keys',
  {
    tenantId: uuid()
      .primaryKey()
      .references(() => tenants.id),
    dekVersion: integer().notNull().default(1),
    wrappedDek: text().notNull(),
    kekVersion: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** 暗号学的削除の実行日時。設定後はunwrapできない(=そのテナントの全PIIが永久に復号不能)。 */
    revokedAt: timestamp({ withTimezone: true }),
  },
  () => [pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING })],
).enableRLS();
