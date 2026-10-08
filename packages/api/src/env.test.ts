import { describe, expect, it } from 'vitest';
import { demoResetRetentionDays, loadEnv } from './env';

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
  OUTBOX_DRAIN_JOB: 'projects/p/locations/asia-northeast1/jobs/katahimo-outbox-drain',
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

  it('ローカル開発用の顧客CSVのフォルダ(CUSTOMER_CSV_LOCAL_DIR)は本番では起動前に落とす(開発では使える)', () => {
    expect(() => loadEnv({ ...production, CUSTOMER_CSV_LOCAL_DIR: '/tmp/csv' })).toThrow(
      /CUSTOMER_CSV_LOCAL_DIR/,
    );
    expect(loadEnv({ ...production, CUSTOMER_CSV_LOCAL_DIR: '' }).CUSTOMER_CSV_LOCAL_DIR).toBeUndefined();
    expect(loadEnv({ ...development, CUSTOMER_CSV_LOCAL_DIR: '/tmp/csv' }).CUSTOMER_CSV_LOCAL_DIR).toBe(
      '/tmp/csv',
    );
  });

  it('デモ専用の環境(DEMO_PUBLIC_LOGIN=true)は本番でも秘密値のローカル鍵を使える', () => {
    const demo = {
      ...production,
      SECRET_BOX_PROVIDER: 'local',
      SECRET_BOX_KMS_KEY: '',
      SECRET_BOX_LOCAL_KEY: hex('b'),
      DEMO_TENANT_SLUG: 'public-demo',
      DEMO_PUBLIC_LOGIN: 'true',
    };
    expect(loadEnv(demo)).toMatchObject({ SECRET_BOX_PROVIDER: 'local' });
    expect(() => loadEnv({ ...demo, DEMO_PUBLIC_LOGIN: '' })).toThrow(/SECRET_BOX_PROVIDER/);
  });

  it('本番で足りない・開発用のままの設定をまとめて起動前に落とす', () => {
    const missing = ['SECRET_BOX_PROVIDER', 'STORAGE_PROVIDER', 'SCHEDULE_PROVIDER', 'OUTBOX_DRAIN_JOB'];
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

  it('ミラーは GAS Bridge の持ち主のテナント(GAS_BRIDGE_TENANT)が無いと起動できない', () => {
    const bridge = { GAS_BRIDGE_URL: 'https://script.google.com/macros/s/x/exec', GAS_BRIDGE_SECRET: 's' };
    expect(() => loadEnv({ ...development, ...bridge, MIRROR_TO_GOOGLE_SHEETS: 'true' })).toThrow(
      /GAS_BRIDGE_TENANT/,
    );
    expect(() => loadEnv({ ...development, MIRROR_TO_GOOGLE_SHEETS: 'true' })).toThrow(
      /MIRROR_TO_GOOGLE_SHEETS/,
    );
    expect(
      loadEnv({ ...development, ...bridge, GAS_BRIDGE_TENANT: 'Cutest', MIRROR_TO_GOOGLE_SHEETS: 'true' }),
    ).toMatchObject({ GAS_BRIDGE_TENANT: 'cutest', MIRROR_TO_GOOGLE_SHEETS: true });
  });

  it('公開デモの設定: 既定値、DEMO_PUBLIC_LOGIN は DEMO_TENANT_SLUG が無いと起動できない、日数・月数の範囲', () => {
    // デモ専用の環境でなければ、保存期間は明示したときだけ(本番の環境に置いたデモ用テナントで期間を約束しない)
    expect(loadEnv(development)).toMatchObject({
      DEMO_PUBLIC_LOGIN: false,
      DEMO_DATA_RETENTION_DAYS: null,
      DEMO_LOG_RETENTION_MONTHS: null,
    });
    expect(
      loadEnv({ ...development, DEMO_TENANT_SLUG: 'public-demo', DEMO_LOG_RETENTION_MONTHS: '13' }),
    ).toMatchObject({ DEMO_DATA_RETENTION_DAYS: null, DEMO_LOG_RETENTION_MONTHS: 13 });
    // デモ専用の環境では未設定でも 30日・12か月(操作ログは12か月より短く消せないため)
    expect(
      loadEnv({ ...development, DEMO_TENANT_SLUG: 'public-demo', DEMO_PUBLIC_LOGIN: 'true' }),
    ).toMatchObject({ DEMO_DATA_RETENTION_DAYS: 30, DEMO_LOG_RETENTION_MONTHS: 12 });
    // demo:reset は未設定でも 30日で消す
    expect(demoResetRetentionDays(loadEnv(development))).toBe(30);
    expect(demoResetRetentionDays(loadEnv({ ...development, DEMO_DATA_RETENTION_DAYS: '7' }))).toBe(7);
    expect(() => loadEnv({ ...development, DEMO_PUBLIC_LOGIN: 'true' })).toThrow(/DEMO_PUBLIC_LOGIN/);
    expect(
      loadEnv({
        ...development,
        DEMO_TENANT_SLUG: 'public-demo',
        DEMO_PUBLIC_LOGIN: 'true',
        DEMO_DATA_RETENTION_DAYS: '7',
        DEMO_LOG_RETENTION_MONTHS: '',
      }),
    ).toMatchObject({ DEMO_PUBLIC_LOGIN: true, DEMO_DATA_RETENTION_DAYS: 7, DEMO_LOG_RETENTION_MONTHS: 12 });
    expect(loadEnv({ ...development, DEMO_PUBLIC_LOGIN: 'false' }).DEMO_PUBLIC_LOGIN).toBe(false);
    expect(() => loadEnv({ ...development, DEMO_DATA_RETENTION_DAYS: '0' })).toThrow(
      /DEMO_DATA_RETENTION_DAYS/,
    );
    expect(() => loadEnv({ ...development, DEMO_DATA_RETENTION_DAYS: '3651' })).toThrow();
    expect(() => loadEnv({ ...development, DEMO_LOG_RETENTION_MONTHS: '121' })).toThrow(
      /DEMO_LOG_RETENTION_MONTHS/,
    );
    expect(() => loadEnv({ ...development, DEMO_LOG_RETENTION_MONTHS: '11' })).toThrow(
      /DEMO_LOG_RETENTION_MONTHS/,
    );
  });

  it('OUTBOX_DRAIN_JOB はジョブの完全な名前だけを受け付ける(開発では省略できる)', () => {
    expect(loadEnv(development).OUTBOX_DRAIN_JOB).toBeUndefined();
    expect(() => loadEnv({ ...production, OUTBOX_DRAIN_JOB: 'katahimo-outbox-drain' })).toThrow(
      /OUTBOX_DRAIN_JOB/,
    );
  });

  it('SECRET_BOX_LOCAL_KEY の無いローカル設定は起動できない', () => {
    expect(() => loadEnv({ ...development, SECRET_BOX_LOCAL_KEY: '' })).toThrow(/SECRET_BOX_LOCAL_KEY/);
  });
});
