import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writePrivateFile } from './privateFile';

describe.skipIf(process.platform === 'win32')('writePrivateFile', () => {
  let dir: string | null = null;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('新しいファイルも、既にある広い権限のファイルへの上書きも 0600 にする', async () => {
    dir = await mkdtemp(join(tmpdir(), 'katahimo-private-'));
    const fresh = join(dir, 'fresh.html');
    await writePrivateFile(fresh, 'a');
    expect((await stat(fresh)).mode & 0o777).toBe(0o600);

    const existing = join(dir, 'existing.html');
    await writeFile(existing, 'old');
    await chmod(existing, 0o644);
    await writePrivateFile(existing, 'テナントのデータ');
    expect((await stat(existing)).mode & 0o777).toBe(0o600);
    expect(await readFile(existing, 'utf8')).toBe('テナントのデータ');
  });
});
