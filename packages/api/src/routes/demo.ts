import {
  DEMO_ACCOUNTS,
  DEMO_AI_USES_PER_SESSION,
  type DemoConfigResponse,
  demoConfigResponseSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import type { DemoSettings } from '../http/demoRestrictions';
import { jsonOk } from '../http/responses';

/**
 * 公開デモの表示の設定(環境変数 DEMO_* から作る。DB は読まない)。デモ用アカウントとパスワードは、デモ専用の環境
 * (DEMO_PUBLIC_LOGIN=true)のときだけ返す(本番の環境に暫定でデモ用テナントを置くときに本番の利用者へ出さない)。
 */
export function demoConfigOf(settings: DemoSettings | null): DemoConfigResponse {
  if (!settings) return { enabled: false };
  return {
    enabled: true,
    tenantSlug: settings.slug,
    publicLogin: settings.publicLogin,
    accounts: settings.publicLogin
      ? DEMO_ACCOUNTS.map(({ role, label, email }) => ({ role, label, email }))
      : [],
    password: null,
    dataRetentionDays: settings.dataRetentionDays,
    logRetentionMonths: settings.logRetentionMonths,
    aiUsesPerSession: DEMO_AI_USES_PER_SESSION,
  };
}

/**
 * GET /api/demo/config(ログイン不要)。web はビルドの設定ではなくこれを見て、ログイン画面のデモ用アカウント・注意書き、
 * 「デモ環境」の帯を出す(本番とデモで同じイメージを使うため)。読むだけで、操作ログには残さない。
 */
export function createDemoRoutes(container: Container) {
  const app = new Hono();
  const config = demoConfigOf(container.demo?.settings ?? null);
  app.get('/config', (c) => jsonOk(c, demoConfigResponseSchema, config));
  return app;
}
