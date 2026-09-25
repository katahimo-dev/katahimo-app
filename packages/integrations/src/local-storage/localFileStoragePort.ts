import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { StoragePort, StoredFile } from '@katahimo/core/ports';

/**
 * ローカル開発用のファイルシステム実装。本番はGCS等のオブジェクトストレージに置き換える
 * (packages/core/src/ports/storage.ts参照)。keyは呼び出し側(usecase)がrandomUUID()で
 * 生成した値のみを渡す前提で、ユーザー入力を直接keyに使わないため、パストラバーサル
 * (`../`等)は原理的に混入しない。念のため解決後のパスがbaseDir配下にあることも検証する。
 */
export class LocalFileStoragePort implements StoragePort {
  constructor(private readonly baseDir: string) {}

  private resolvePath(key: string): string {
    const resolvedBase = resolve(this.baseDir);
    const resolvedPath = resolve(resolvedBase, key);
    if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(resolvedBase + sep)) {
      throw new Error(`不正なストレージキーです: ${key}`);
    }
    return resolvedPath;
  }

  async put(key: string, contentType: string, body: Uint8Array): Promise<StoredFile> {
    const path = this.resolvePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { key, contentType, byteSize: body.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const buffer = await readFile(this.resolvePath(key));
      return new Uint8Array(buffer);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }

  /** ローカル開発では実際の署名付きURLは発行せず、API経由の配信パスをそのまま返す(認可はAPIルート側で行う)。 */
  async signedUrl(key: string): Promise<string> {
    return `/api/files/${encodeURIComponent(key)}`;
  }
}
