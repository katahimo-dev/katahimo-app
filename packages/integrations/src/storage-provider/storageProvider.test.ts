import { describe, expect, it } from 'vitest';
import { GcsStoragePort } from '../gcs-storage';
import { LocalFileStoragePort } from '../local-storage';
import { createStoragePort, storageEnvProblems } from './storageProvider';

const local = { STORAGE_PROVIDER: 'local', LOCAL_RECEIPT_STORAGE_DIR: './data/receipts' } as const;
const gcs = { ...local, STORAGE_PROVIDER: 'gcs', GCS_BUCKET: 'katahimo-receipts' } as const;

describe('createStoragePort', () => {
  it('STORAGE_PROVIDER で実装を切り替える', () => {
    expect(createStoragePort(local)).toBeInstanceOf(LocalFileStoragePort);
    expect(createStoragePort(gcs)).toBeInstanceOf(GcsStoragePort);
  });

  it('gcs でバケット未指定なら例外', () => {
    expect(() => createStoragePort({ ...gcs, GCS_BUCKET: undefined })).toThrow(/GCS_BUCKET/);
  });
});

describe('storageEnvProblems', () => {
  it('本番はローカル保存を拒否し、gcs はバケット名を要求する', () => {
    expect(storageEnvProblems(local, false)).toEqual([]);
    expect(storageEnvProblems(gcs, true)).toEqual([]);
    expect(storageEnvProblems(local, true).join()).toMatch(/STORAGE_PROVIDER/);
    expect(storageEnvProblems({ ...gcs, GCS_BUCKET: undefined }, true).join()).toMatch(/GCS_BUCKET/);
  });
});
