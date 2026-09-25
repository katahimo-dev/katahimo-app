import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  CustomerCsvSourceFile,
  CustomerCsvSourcePort,
  CustomerCsvSourceTenant,
} from '@katahimo/core/ports';

/**
 * ローカル開発用の取込元: `<rootDir>/<テナントslug>/` に置いたCSVを読む。
 * テナントのディレクトリが無ければ「取込元なし」(自動取込の対象外)として扱う。
 */
export class LocalDirectoryCustomerCsvSource implements CustomerCsvSourcePort {
  constructor(private readonly rootDir: string) {}

  private tenantDir(tenant: CustomerCsvSourceTenant): string {
    return join(this.rootDir, basename(tenant.slug));
  }

  async listFiles(tenant: CustomerCsvSourceTenant): Promise<CustomerCsvSourceFile[] | null> {
    const dir = this.tenantDir(tenant);
    if (!existsSync(dir)) return null;
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => ({ id: e.name, name: e.name }));
  }

  async readFile(tenant: CustomerCsvSourceTenant, file: CustomerCsvSourceFile): Promise<Buffer> {
    // listFiles が返したファイル名以外(パス区切りを含む値)でディレクトリの外を読まないようにする。
    return readFile(join(this.tenantDir(tenant), basename(file.id)));
  }
}
