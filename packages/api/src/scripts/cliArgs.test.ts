import { describe, expect, it } from 'vitest';
import { cliArgs, resolveInputPath, takeOption, takeRepeatedOption } from './cliArgs';

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

  it('`--name 値` を何回でも取り出す(値の無い最後の --name は undefined)', () => {
    expect(
      takeRepeatedOption(['demo', '--month', '2026-09', 'x', '--month', '2026-10', '--month'], '--month'),
    ).toEqual({
      rest: ['demo', 'x'],
      values: ['2026-09', '2026-10', undefined],
    });
  });

  it('相対パスはコマンドを打ったフォルダから、絶対パスはそのまま', () => {
    expect(resolveInputPath('data/a.csv', '/work')).toBe('/work/data/a.csv');
    expect(resolveInputPath('/tmp/a.csv', '/work')).toBe('/tmp/a.csv');
  });
});
