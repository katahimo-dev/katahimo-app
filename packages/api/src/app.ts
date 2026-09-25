import { Hono } from 'hono';
import type { Container } from './container';
import type { Env } from './env';
import { trustedProxyHops } from './env';
import { onApiError, requestLogger, writeStructuredLog } from './http/requestLog';
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
  container: Container;
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const { container } = deps;

  // 全レスポンス(API・画面)共通: リクエストのログと ID、送信元IPの判定、セキュリティヘッダー(CSP・HSTS等)
  app.use('*', requestLogger({ projectId: process.env.GOOGLE_CLOUD_PROJECT }));
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
      await container.pingDatabase();
      return c.json({ status: 'ok' });
    } catch (e) {
      writeStructuredLog({
        severity: 'ERROR',
        message: 'DBの疎通確認に失敗しました',
        error: e instanceof Error ? e.message : String(e),
      });
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
  // DomainError → code に応じた応答、想定外の例外 → ログに残して 500 internal(応答に内部の情報を出さない)
  app.onError(onApiError);

  return app;
}
