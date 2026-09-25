import type { StoragePort } from '@katahimo/core/ports';
import { createGcsJsonApiClient, GcsStoragePort } from '../gcs-storage';
import { LocalFileStoragePort } from '../local-storage';

export const STORAGE_PROVIDERS = ['local', 'gcs'] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

/** ファイル保存先の選択に使う環境変数(api/worker の env から渡す)。 */
export interface StorageProviderEnv {
  STORAGE_PROVIDER: StorageProvider;
  LOCAL_RECEIPT_STORAGE_DIR: string;
  GCS_BUCKET?: string | undefined;
}

/** 起動時の設定検証(環境変数の検証エラーと同じ形式の行)。本番はオブジェクトストレージ必須。 */
export function storageEnvProblems(env: StorageProviderEnv, isProduction: boolean): string[] {
  const problems: string[] = [];
  if (env.STORAGE_PROVIDER === 'gcs' && !env.GCS_BUCKET) {
    problems.push('  - GCS_BUCKET: STORAGE_PROVIDER=gcs には保存先のバケット名が必要です');
  }
  if (isProduction && env.STORAGE_PROVIDER !== 'gcs') {
    problems.push(
      '  - STORAGE_PROVIDER: 本番は gcs にしてください(Cloud Run のローカルディスクはインスタンスと共に消えます)',
    );
  }
  return problems;
}

/**
 * 領収書画像等の保存先。local: LOCAL_RECEIPT_STORAGE_DIR(開発用) / gcs: GCS_BUCKET(本番)。
 * Cloud Run のファイルシステムはインスタンスごとのメモリ上にあり消えるため、本番は gcs にする
 * (api/worker の env.ts が本番で local を拒否する)。
 */
export function createStoragePort(env: StorageProviderEnv): StoragePort {
  switch (env.STORAGE_PROVIDER) {
    case 'local':
      return new LocalFileStoragePort(env.LOCAL_RECEIPT_STORAGE_DIR);
    case 'gcs': {
      if (!env.GCS_BUCKET) throw new Error('STORAGE_PROVIDER=gcs には GCS_BUCKET が必要です');
      return new GcsStoragePort({ bucket: env.GCS_BUCKET, ...createGcsJsonApiClient() });
    }
  }
}
