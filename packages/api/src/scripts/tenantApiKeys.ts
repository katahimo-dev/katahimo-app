import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { userInfo } from 'node:os';
import type { IntegrationApiKeyRecord } from '@katahimo/core/ports';
import {
  createIntegrationApiKey,
  listIntegrationApiKeys,
  revokeIntegrationApiKey,
} from '@katahimo/core/usecases';
import { closeDatabase, createDatabase, DrizzleUnitOfWork } from '@katahimo/db';
import { DrizzleAppLogRepository, DrizzleTenantDirectory } from '@katahimo/db/repositories';
import { cliArgs, takeOption } from './cliArgs';

const USAGE = [
  '使い方: pnpm tenant:api-keys -- <slug> [--create <名前> [--source reserva|external_api]] [--revoke <キーのID>]',
  '  オプションを付けなければキーの一覧を表示する。--create のトークンはこの1回しか表示しない(DB には SHA-256 だけを残す)',
  '  --source はこのキーで書ける顧客の取込元(既定 external_api。RESERVA からの連携は reserva: 顧客CSVと同じ顧客IDの顧客を更新する)',
].join('\n');

type Command =
  | { kind: 'list' }
  | { kind: 'create'; name: string; source: string }
  | { kind: 'revoke'; id: string };

function parseCommand(args: string[]): Command | null {
  const create = takeOption(args, '--create');
  const source = takeOption(create.rest, '--source');
  const revoke = takeOption(source.rest, '--revoke');
  if (revoke.rest.length > 0) return null;
  if (create.value !== undefined && revoke.value === undefined) {
    return { kind: 'create', name: create.value, source: source.value ?? 'external_api' };
  }
  if (source.value !== undefined) return null;
  if (revoke.value !== undefined && create.value === undefined) return { kind: 'revoke', id: revoke.value };
  if (args.length === 0) return { kind: 'list' };
  return null;
}

const at = (date: Date | null) => (date ? date.toISOString() : '-');

function printKey(key: IntegrationApiKeyRecord) {
  console.log(
    `  ${key.id}  ${key.revokedAt ? '失効' : '有効'}  取込元=${key.customerSource}  名前=${key.name}  ` +
      `発行=${at(key.createdAt)}(${key.createdBy})  最終利用=${at(key.lastUsedAt)}` +
      (key.revokedAt ? `  失効=${at(key.revokedAt)}` : ''),
  );
}

/**
 * テナントの外部システム連携の API キー(integration_api_keys)を運用担当者が発行・一覧・失効させる
 * (doc/07_インフラ・運用.md)。アプリのロールはキーを作れないため、MIGRATION_DATABASE_URL(所有者)の接続で動く。
 */
async function main() {
  const [slug, ...rest] = cliArgs();
  const command = slug ? parseCommand(rest) : null;
  if (!slug || !command) {
    console.error(USAGE);
    process.exit(1);
  }
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl)
    throw new Error('API キーの管理には MIGRATION_DATABASE_URL(katahimo_migrator)が必要です');

  const ownerDb = createDatabase(migrationUrl, { max: 1, onnotice: () => {} });
  try {
    const deps = {
      tenants: new DrizzleTenantDirectory(ownerDb),
      uow: new DrizzleUnitOfWork(ownerDb),
      appLog: new DrizzleAppLogRepository(ownerDb),
    };
    if (command.kind === 'create') {
      const { key, token } = await createIntegrationApiKey(deps, slug, {
        name: command.name,
        customerSource: command.source,
        createdBy: userInfo().username,
      });
      console.log(`[api-keys] ${slug} に API キーを発行しました:`);
      printKey(key);
      console.log('[api-keys] トークン(この1回しか表示しません。連携先に安全な方法で渡してください):');
      console.log(token);
      return;
    }
    if (command.kind === 'revoke') {
      const key = await revokeIntegrationApiKey(deps, slug, command.id);
      console.log(`[api-keys] ${slug} の API キーを失効させました:`);
      printKey(key);
      return;
    }
    const keys = await listIntegrationApiKeys(deps, slug);
    console.log(`[api-keys] ${slug} の API キー(${keys.length}件):`);
    for (const key of keys) printKey(key);
  } finally {
    await closeDatabase(ownerDb);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
