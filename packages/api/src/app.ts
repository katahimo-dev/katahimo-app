import type { Database } from '@katahimo/db';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { createContainer } from './container';
import type { Env } from './env';
import { trustedProxyHops } from './env';
import { clientIpMiddleware } from './http/requestMeta';
import {
  apiBodyLimits,
  csrfProtection,
  noStoreApiResponses,
  requireJsonBody,
  securityHeaders,
} from './http/security';
import { registerWebStatic } from './http/webStatic';
import { createAdminImportRoutes } from './routes/adminImport';
import { createAdminStaffRoutes } from './routes/adminStaff';
import { createAttendanceRoutes } from './routes/attendance';
import { createAuthRoutes } from './routes/auth';
import { createCustomerRoutes } from './routes/customers';
import { createDataVersionRoutes } from './routes/dataVersion';
import { createReceiptRoutes } from './routes/receipts';
import { createReportRoutes } from './routes/reports';
import { createScheduleRoutes } from './routes/schedule';
import { createSettingsRoutes } from './routes/settings';
import { createStaffRoutes } from './routes/staff';
import { createUiConfigRoutes } from './routes/uiConfig';

export interface AppDeps {
  env: Env;
  db: Database;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const container = createContainer(deps.env, deps.db);

  // 全レスポンス(API・画面)共通: 送信元IPの判定とセキュリティヘッダー(CSP・HSTS等)
  app.use('*', clientIpMiddleware(trustedProxyHops(deps.env)));
  app.use('*', securityHeaders(container.config.isProduction));
  // API: キャッシュさせない・CSRF対策(別サイトからの状態変更を拒否)・JSON以外の本体は415・本体の大きさの上限
  app.use('/api/*', noStoreApiResponses());
  app.use('/api/*', csrfProtection());
  app.use('/api/*', requireJsonBody());
  app.use('/api/*', apiBodyLimits());

  /** Cloud Run のヘルスチェック用。DBに触らない軽量な生存確認。 */
  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  /**
   * DB接続まで含めた疎通確認。デプロイ直後の確認とローカル動作確認に使う。認証なしで呼べるため、
   * 失敗の詳細(接続先・エラー文)は応答に含めずプロセスログにだけ出す。
   */
  app.get('/api/health/db', async (c) => {
    try {
      await deps.db.execute(sql`SELECT 1`);
      return c.json({ status: 'ok' });
    } catch (e) {
      console.error(
        JSON.stringify({
          severity: 'ERROR',
          message: 'DBの疎通確認に失敗しました',
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      return c.json({ status: 'error' }, 503);
    }
  });

  app.route('/api/auth', createAuthRoutes(container));
  app.route('/api/customers', createCustomerRoutes(container));
  app.route('/api/attendance', createAttendanceRoutes(container));
  app.route('/api/reports', createReportRoutes(container));
  app.route('/api/receipts', createReceiptRoutes(container));
  app.route('/api/schedule', createScheduleRoutes(container));
  app.route('/api/settings', createSettingsRoutes(container));
  app.route('/api/staff', createStaffRoutes(container));
  app.route('/api/admin/customers', createAdminImportRoutes(container));
  app.route('/api/data-version', createDataVersionRoutes(container));
  app.route('/api/admin/staff', createAdminStaffRoutes(container));
  app.route('/api/ui-config', createUiConfigRoutes(container));

  // 本番コンテナではビルド済みのWeb画面も同じオリジンから配信する(APIのルートより後に登録し、/api を優先)
  if (deps.env.WEB_DIST_DIR) registerWebStatic(app, deps.env.WEB_DIST_DIR);

  app.notFound((c) => c.json({ code: 'not_found', message: '該当するAPIがありません' }, 404));

  return app;
}
