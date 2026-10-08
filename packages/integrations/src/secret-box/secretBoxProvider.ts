import type { SecretBoxPort } from '@katahimo/core/ports';
import { createCloudKmsApiClient } from './cloudKmsApiClient';
import { CloudKmsSecretBox } from './cloudKmsSecretBox';
import { LocalSecretBox } from './localSecretBox';

export const SECRET_BOX_PROVIDERS = ['local', 'gcp'] as const;
export type SecretBoxProvider = (typeof SECRET_BOX_PROVIDERS)[number];

/** テナントの秘密値の封に使う鍵の選択(API の env から渡す)。 */
export interface SecretBoxEnv {
  SECRET_BOX_PROVIDER: SecretBoxProvider;
  SECRET_BOX_LOCAL_KEY?: string | undefined;
  SECRET_BOX_KMS_KEY?: string | undefined;
}

/** 起動時の設定検証(環境変数の検証エラーと同じ形式の行)。本番は Cloud KMS 必須(KMS を使わないデモ専用の環境だけ allowLocal で local を許可)。 */
export function secretBoxEnvProblems(env: SecretBoxEnv, isProduction: boolean, allowLocal = false): string[] {
  const problems: string[] = [];
  if (env.SECRET_BOX_PROVIDER === 'local' && !env.SECRET_BOX_LOCAL_KEY) {
    problems.push(
      '  - SECRET_BOX_LOCAL_KEY: SECRET_BOX_PROVIDER=local には32バイト(64桁の16進数)の鍵が必要です',
    );
  }
  if (env.SECRET_BOX_PROVIDER === 'gcp' && !env.SECRET_BOX_KMS_KEY) {
    problems.push('  - SECRET_BOX_KMS_KEY: SECRET_BOX_PROVIDER=gcp には Cloud KMS の鍵名が必要です');
  }
  if (isProduction && !allowLocal && env.SECRET_BOX_PROVIDER !== 'gcp') {
    problems.push(
      '  - SECRET_BOX_PROVIDER: 本番は gcp(Cloud KMS)にしてください(SECRET_BOX_LOCAL_KEY は開発用です。KMS を使わないのはデモ専用の環境 DEMO_PUBLIC_LOGIN=true だけ)',
    );
  }
  return problems;
}

/**
 * local: SECRET_BOX_LOCAL_KEY(開発用) / gcp: Cloud KMS の鍵 SECRET_BOX_KMS_KEY(本番)。
 * 鍵や実装を切り替えると保存済みの秘密値は開けなくなる(管理者設定で保存し直す)。
 */
export function createSecretBox(env: SecretBoxEnv): SecretBoxPort {
  switch (env.SECRET_BOX_PROVIDER) {
    case 'local':
      if (!env.SECRET_BOX_LOCAL_KEY)
        throw new Error('SECRET_BOX_PROVIDER=local には SECRET_BOX_LOCAL_KEY が必要です');
      return new LocalSecretBox(env.SECRET_BOX_LOCAL_KEY);
    case 'gcp':
      if (!env.SECRET_BOX_KMS_KEY)
        throw new Error('SECRET_BOX_PROVIDER=gcp には SECRET_BOX_KMS_KEY が必要です');
      return new CloudKmsSecretBox(env.SECRET_BOX_KMS_KEY, createCloudKmsApiClient());
  }
}
