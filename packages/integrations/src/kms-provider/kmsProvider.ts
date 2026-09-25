import type { KeyManagementPort } from '@katahimo/core/ports';
import { CloudKmsPort, createCloudKmsApiClient } from '../cloud-kms';
import { LocalKmsPort } from '../local-kms';

export const KMS_PROVIDERS = ['local', 'gcp'] as const;
export type KmsProvider = (typeof KMS_PROVIDERS)[number];

/** テナントDEKをラップするKEKの選択に使う環境変数(api/worker の env から渡す)。 */
export interface KmsProviderEnv {
  KMS_PROVIDER: KmsProvider;
  LOCAL_DEV_KEK?: string | undefined;
  GCP_KMS_KEY_NAME?: string | undefined;
}

/** 起動時の設定検証(環境変数の検証エラーと同じ形式の行)。本番は Cloud KMS 必須。 */
export function kmsEnvProblems(env: KmsProviderEnv, isProduction: boolean): string[] {
  const problems: string[] = [];
  if (env.KMS_PROVIDER === 'local' && !env.LOCAL_DEV_KEK) {
    problems.push('  - LOCAL_DEV_KEK: KMS_PROVIDER=local には32バイト(64桁の16進数)のKEKが必要です');
  }
  if (env.KMS_PROVIDER === 'gcp' && !env.GCP_KMS_KEY_NAME) {
    problems.push('  - GCP_KMS_KEY_NAME: KMS_PROVIDER=gcp には Cloud KMS の鍵名が必要です');
  }
  if (isProduction && env.KMS_PROVIDER !== 'gcp') {
    problems.push('  - KMS_PROVIDER: 本番は gcp(Cloud KMS)にしてください(LOCAL_DEV_KEK は開発用の代替です)');
  }
  return problems;
}

/**
 * local: 環境変数 LOCAL_DEV_KEK(開発用のKMS代替) / gcp: Cloud KMS の鍵 GCP_KMS_KEY_NAME(本番)。
 * 途中で切り替えると既存の tenant_keys を復号できなくなるため、環境ごとに最初に決めて変えないこと。
 */
export function createKeyManagementPort(env: KmsProviderEnv): KeyManagementPort {
  switch (env.KMS_PROVIDER) {
    case 'local':
      if (!env.LOCAL_DEV_KEK) throw new Error('KMS_PROVIDER=local には LOCAL_DEV_KEK が必要です');
      return new LocalKmsPort(env.LOCAL_DEV_KEK);
    case 'gcp':
      if (!env.GCP_KMS_KEY_NAME) throw new Error('KMS_PROVIDER=gcp には GCP_KMS_KEY_NAME が必要です');
      return new CloudKmsPort({ keyName: env.GCP_KMS_KEY_NAME, client: createCloudKmsApiClient() });
  }
}
