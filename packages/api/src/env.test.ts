import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const hex = (ch: string) => ch.repeat(64);

/** 開発環境として起動できる最小の設定。 */
const development = {
  DATABASE_URL: 'postgres://katahimo_app:x@localhost:5432/katahimo_dev',
  SESSION_SECRET: 'change-me-in-production',
  SECRET_BOX_LOCAL_KEY: hex('a'),
};

/** Cloud Run 本番の設定(infra/gcp/run.tf が渡すもの)。 */
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://katahimo_app:x@/katahimo?host=/cloudsql/p:asia-northeast1:katahimo-db',
  SESSION_SECRET: 'f'.repeat(64),
  SECRET_BOX_PROVIDER: 'gcp',
  SECRET_BOX_KMS_KEY: 'projects/p/locations/asia-northeast1/keyRings/katahimo/cryptoKeys/tenant-secrets',
  STORAGE_PROVIDER: 'gcs',
  GCS_BUCKET: 'p-katahimo-receipts',
  SCHEDULE_PROVIDER: 'google',
  WEB_DIST_DIR: '/app/web',
};

describe('loadEnv', () => {
  it('開発環境はローカル実装(秘密値のローカル鍵・ファイル保存)を既定にする', () => {
    const env = loadEnv(development);
    expect(env).toMatchObject({ SECRET_BOX_PROVIDER: 'local', STORAGE_PROVIDER: 'local' });
    expect(env.WEB_DIST_DIR).toBeUndefined();
  });

  it('本番の設定一式を受け付ける(SECRET_BOX_LOCAL_KEY は不要)', () => {
    expect(loadEnv(production)).toMatchObject({ SECRET_BOX_PROVIDER: 'gcp', WEB_DIST_DIR: '/app/web' });
  });

  it('本番で足りない・開発用のままの設定をまとめて起動前に落とす', () => {
    const missing = ['SECRET_BOX_PROVIDER', 'STORAGE_PROVIDER', 'SCHEDULE_PROVIDER'];
    const source = Object.fromEntries(
      Object.entries({ ...production, SESSION_SECRET: 'change-me-in-production' }).filter(
        ([key]) => !missing.includes(key),
      ),
    );
    let message = '';
    try {
      loadEnv(source);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    for (const name of [...missing, 'SESSION_SECRET']) {
      expect(message).toContain(`- ${name}:`);
    }
  });

  it('SECRET_BOX_LOCAL_KEY の無いローカル設定は起動できない', () => {
    expect(() => loadEnv({ ...development, SECRET_BOX_LOCAL_KEY: '' })).toThrow(/SECRET_BOX_LOCAL_KEY/);
  });
});
