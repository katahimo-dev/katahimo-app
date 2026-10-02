import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './env';

/** Cloud Run 本番のワーカーの設定(infra/gcp/run.tf が渡すもの)の最小。 */
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://katahimo_app:x@/katahimo?host=/cloudsql/p:asia-northeast1:katahimo-db',
  WORKER_DATABASE_URL: 'postgres://katahimo_worker:x@/katahimo?host=/cloudsql/p:asia-northeast1:katahimo-db',
  STORAGE_PROVIDER: 'gcs',
  GCS_BUCKET: 'p-katahimo-receipts',
  SCHEDULE_PROVIDER: 'google',
  GOOGLE_MAPS_API_KEY: 'key',
  SMTP_HOST: 'smtp.example.com',
};

describe('loadWorkerEnv', () => {
  it('ローカル開発用の顧客CSVのフォルダ(CUSTOMER_CSV_LOCAL_DIR)は本番では起動前に落とす', () => {
    expect(() => loadWorkerEnv(production)).not.toThrow();
    expect(() => loadWorkerEnv({ ...production, CUSTOMER_CSV_LOCAL_DIR: '/tmp/csv' })).toThrow(
      /CUSTOMER_CSV_LOCAL_DIR/,
    );
    expect(
      loadWorkerEnv({ ...production, NODE_ENV: 'development', CUSTOMER_CSV_LOCAL_DIR: '/tmp/csv' })
        .CUSTOMER_CSV_LOCAL_DIR,
    ).toBe('/tmp/csv');
  });

  it('SMTP の STARTTLS は既定で必須。false は本番以外だけ', () => {
    expect(loadWorkerEnv(production).SMTP_REQUIRE_TLS).toBe(true);
    expect(loadWorkerEnv({ ...production, SMTP_REQUIRE_TLS: '' }).SMTP_REQUIRE_TLS).toBe(true);
    expect(() => loadWorkerEnv({ ...production, SMTP_REQUIRE_TLS: 'false' })).toThrow(/SMTP_REQUIRE_TLS/);
    expect(() => loadWorkerEnv({ ...production, SMTP_REQUIRE_TLS: 'no' })).toThrow(/SMTP_REQUIRE_TLS/);
    expect(
      loadWorkerEnv({ ...production, NODE_ENV: 'development', SMTP_REQUIRE_TLS: 'false' }).SMTP_REQUIRE_TLS,
    ).toBe(false);
  });
});
