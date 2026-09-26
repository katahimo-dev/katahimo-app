import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TenantCustomerCsvSource } from './createCustomerCsvSource';
import type { CustomerCsvDriveFolderReader } from './googleDriveCustomerCsvSource';

class FakeDrive implements CustomerCsvDriveFolderReader {
  readonly listed: string[] = [];
  async listFiles(folderId: string) {
    this.listed.push(folderId);
    return [{ id: `${folderId}-file`, name: 'Kokyaku_202601191958_1.csv' }];
  }
  async readFile(fileId: string) {
    return Buffer.from(`drive:${fileId}`);
  }
}

describe('TenantCustomerCsvSource(テナントの取込元の設定で取込元を選ぶ)', () => {
  const tenant = { id: 't1', slug: 'demo' };
  const settings = { provider: 'reserva_csv' as const, driveFolderId: 'folder-of-demo-1234' };

  it('設定のあるテナントはそのテナントの Drive のフォルダを読む', async () => {
    const drive = new FakeDrive();
    const source = new TenantCustomerCsvSource(drive);
    const files = await source.listFiles({ tenant, settings });
    expect(drive.listed).toEqual(['folder-of-demo-1234']);
    const file = files?.[0];
    if (!file) throw new Error('ファイルがありません');
    expect((await source.readFile({ tenant, settings }, file)).toString()).toBe(
      'drive:folder-of-demo-1234-file',
    );
  });

  it('設定の無いテナントは、ローカルのディレクトリがあればそこ、無ければ取込元なし(null)', async () => {
    const drive = new FakeDrive();
    expect(await new TenantCustomerCsvSource(drive).listFiles({ tenant, settings: null })).toBeNull();

    const root = mkdtempSync(join(tmpdir(), 'kh-csv-'));
    mkdirSync(join(root, 'demo'));
    writeFileSync(join(root, 'demo', 'Kokyaku_202601010000_1.csv'), 'local');
    const local = new TenantCustomerCsvSource(drive, root);
    const files = await local.listFiles({ tenant, settings: null });
    expect(files).toEqual([{ id: 'Kokyaku_202601010000_1.csv', name: 'Kokyaku_202601010000_1.csv' }]);
    expect(await local.listFiles({ tenant: { id: 't2', slug: 'other' }, settings: null })).toBeNull();
    expect(drive.listed).toEqual([]);
  });
});
