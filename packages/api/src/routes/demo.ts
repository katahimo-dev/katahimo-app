import {
  DEMO_AI_USES_PER_SESSION,
  type DemoConfigResponse,
  demoConfigResponseSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import type { DemoSettings } from '../http/demoRestrictions';
import { jsonOk } from '../http/responses';

/**
 * デモの表示の設定(環境変数 DEMO_* から作る。DB は読まない)。認証情報は環境にかかわらず返さない。
 */
export function demoConfigOf(settings: DemoSettings | null): DemoConfigResponse {
  if (!settings) return { enabled: false };
  return {
    enabled: true,
    tenantSlug: settings.slug,
    publicLogin: settings.publicLogin,
    accounts: [],
    password: null,
    dataRetentionDays: settings.dataRetentionDays,
    logRetentionMonths: settings.logRetentionMonths,
    aiUsesPerSession: DEMO_AI_USES_PER_SESSION,
  };
}

/**
 * GET /api/demo/config(ログイン不要)。web はビルドの設定ではなくこれを見て、ログイン画面の既定の法人ID・注意書き、
 * 「デモ環境」の帯を出す(本番とデモで同じイメージを使うため)。読むだけで、操作ログには残さない。
 */
export function createDemoRoutes(container: Container) {
  const app = new Hono();
  const config = demoConfigOf(container.demo?.settings ?? null);
  app.get('/config', (c) => jsonOk(c, demoConfigResponseSchema, config));
  return app;
}
