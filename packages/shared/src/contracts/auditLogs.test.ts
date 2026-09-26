import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTION_LABELS, AUDIT_LOG_CATEGORIES, auditActionLabel } from './auditLogs';

const PACKAGES_DIR = join(import.meta.dirname, '../../..');
const SERVER_PACKAGES = ['api', 'core', 'db', 'ingestion', 'integrations', 'worker'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.') && !entry.name.includes('testDoubles')
      ? [path]
      : [];
  });
}

const DOTTED = String.raw`'([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'`;
/** 操作ログの操作コードを書く書き方(`action: '…'` と、操作コードを引数に取る記録の関数)。 */
const PATTERNS = [
  new RegExp(String.raw`\baction:\s*${DOTTED}`, 'g'),
  new RegExp(
    String.raw`(?<![.\w])(?:logRejected|logSyncFailure|logCrossStaffRead|writeLog|logAiError|platformStep|logAccess|log)\([^;]*?${DOTTED}`,
    'g',
  ),
];

/** サーバーのコードに書かれている操作コード(runLogged・報告の種類のテンプレートは展開する)。 */
function actionsInCode(): Set<string> {
  const actions = new Set<string>();
  for (const pkg of SERVER_PACKAGES) {
    for (const file of sourceFiles(join(PACKAGES_DIR, pkg, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of PATTERNS) for (const m of text.matchAll(pattern)) actions.add(m[1] as string);
      for (const m of text.matchAll(new RegExp(String.raw`runLogged\(deps, ${DOTTED}`, 'g'))) {
        for (const suffix of ['succeeded', 'failed', 'error']) actions.add(`${m[1]}.${suffix}`);
      }
      for (const m of text.matchAll(/action: `report\.\$\{kind\}\.([a-z_]+)`/g)) {
        for (const kind of ['daily', 'accident']) actions.add(`report.${kind}.${m[1]}`);
      }
    }
  }
  return actions;
}

describe('操作コードの表示名', () => {
  it('サーバーのコードで記録する操作コードには全て日本語の表示名がある', () => {
    const actions = actionsInCode();
    expect(actions.size).toBeGreaterThan(50);
    const missing = [...actions].filter((action) => auditActionLabel(action) === action).sort();
    expect(missing).toEqual([]);
  });

  it('権限のない操作(…access_denied)はまとめた表示名、表示名の無いコードはそのまま', () => {
    expect(auditActionLabel('staff.admin.list.access_denied')).toBe(
      '権限のない操作を断った(staff.admin.list)',
    );
    expect(auditActionLabel('custom.unknown')).toBe('custom.unknown');
  });

  it('表示名のある操作コードは、どれかの操作の種類(絞り込み)に入る', () => {
    const uncategorized = Object.keys(AUDIT_ACTION_LABELS).filter(
      (action) => !AUDIT_LOG_CATEGORIES.some((c) => action.startsWith(c.prefix)),
    );
    expect(uncategorized).toEqual([]);
  });
});
