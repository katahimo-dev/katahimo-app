import { getUiConfig } from '@katahimo/core';
import { Hono } from 'hono';
import type { Container } from '../container';
import type { SessionEnv } from '../session';
import { requireSession } from '../session';

/** 日報/事故報告画面の文言・評価定義。GAS版Main.js getUiConfig。 */
export function createUiConfigRoutes(container: Container) {
  const app = new Hono<SessionEnv>();
  app.get('/', requireSession(container), async (c) =>
    c.json(await getUiConfig(container, c.get('session').tenantId)),
  );
  return app;
}
