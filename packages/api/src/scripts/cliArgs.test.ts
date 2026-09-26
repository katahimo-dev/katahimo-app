import { describe, expect, it } from 'vitest';
import { cliArgs, resolveInputPath, takeOption } from './cliArgs';

describe('運用スクリプトの引数', () => {
  it('pnpm が渡す `--` を取り除く', () => {
    expect(cliArgs(['node', 'script.ts', '--', 'demo', 'a.csv', '--dry-run'])).toEqual([
      'demo',
      'a.csv',
      '--dry-run',
    ]);
  });

  it('`--name 値` のオプションを取り出す', () => {
    expect(takeOption(['demo', '--year', '2026', 'a.csv'], '--year')).toEqual({
      rest: ['demo', 'a.csv'],
      value: '2026',
    });
    expect(takeOption(['demo'], '--year')).toEqual({ rest: ['demo'], value: undefined });
  });

  it('相対パスはコマンドを打ったフォルダから、絶対パスはそのまま', () => {
    expect(resolveInputPath('data/a.csv', '/work')).toBe('/work/data/a.csv');
    expect(resolveInputPath('/tmp/a.csv', '/work')).toBe('/tmp/a.csv');
  });
});
