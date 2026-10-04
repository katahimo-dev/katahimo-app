import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPS_SCRIPTS, opsHelpText } from './opsHelp';

describe('運用スクリプトのジョブの一覧', () => {
  it('tsup の ops/* の entry と同じ名前を全て載せる', () => {
    const config = readFileSync(new URL('../../tsup.config.ts', import.meta.url), 'utf8');
    const entries = [...config.matchAll(/'ops\/([a-z-]+)'/g)].map((m) => m[1]).filter((n) => n !== 'help');
    expect(entries.sort()).toEqual(OPS_SCRIPTS.map((s) => s.name).sort());
  });

  it('pnpm の名前が package.json のスクリプトにある', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const s of OPS_SCRIPTS) expect(pkg.scripts[s.pnpm], s.pnpm).toBeDefined();
    expect(opsHelpText()).toContain('dist/ops/tenant-create.js');
  });
});
