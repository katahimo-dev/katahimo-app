// 一時スクリプト: xlsx を手元で読み、デモ用の管理者で日報AIの調整の行ごとの API に送る(コミットしない)
import { readFileSync } from 'node:fs';
import { parseReportAiWorkbook } from '@katahimo/core/domain';
import { readReportAiWorkbook } from '../src/export/reportAiWorkbook';

const [file, base, slug, email, password, mode] = process.argv.slice(2);
if (!file || !base || !slug || !email || !password) throw new Error('args: file base slug email password [apply]');
const apply = mode === 'apply';

const sheets = await readReportAiWorkbook(readFileSync(file));
const p = parseReportAiWorkbook(sheets);
if (p.errors.length > 0) throw new Error(`xlsx errors: ${JSON.stringify(p.errors)}`);

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ tenantSlug: slug, email, password }),
});
if (!login.ok) throw new Error(`login ${login.status} ${await login.text()}`);
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api/admin/report-ai${path}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text}`);
  return JSON.parse(text);
}

const counts = (m: Record<string, unknown[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.length]));

const cur = await call('GET', '');
console.log('現在:', counts(cur));
if (cur.ageBands.length > 0) {
  console.log(
    '既存の年齢帯:',
    cur.ageBands.map((b: { label: string; ageFromMonths: number; ageToMonths: number }) =>
      `${b.label}[${b.ageFromMonths},${b.ageToMonths})`,
    ),
  );
}

type Row = { id: string; rowVersion: number };
// biome-ignore lint/suspicious/noExplicitAny: 一時スクリプト
type Any = any;
const tables: { kind: string; rows: object[]; existing: Row[]; key: (r: Any) => string }[] = [
  { kind: 'age-bands', rows: p.ageBands, existing: cur.ageBands, key: (r) => r.label },
  { kind: 'keywords', rows: p.keywords, existing: cur.keywords, key: (r) => r.code },
  { kind: 'phrases', rows: p.phrases, existing: cur.phrases, key: (r) => `${r.kind}\u0000${r.body}` },
  { kind: 'stance-rules', rows: p.stanceRules, existing: cur.stanceRules, key: (r) => r.topic },
];
const levels = [
  { kind: 'education-levels', rows: p.educationLevels, existing: cur.educationLevels },
  { kind: 'psi-levels', rows: p.psiLevels, existing: cur.psiLevels },
];

let created = 0;
let updated = 0;
for (const t of tables) {
  const byKey = new Map(t.existing.map((r) => [t.key(r), r]));
  for (const row of t.rows) {
    const hit = byKey.get(t.key(row));
    if (hit) updated++;
    else created++;
    if (!apply) continue;
    if (hit) await call('PUT', `/${t.kind}/${hit.id}`, { row, rowVersion: hit.rowVersion });
    else await call('POST', `/${t.kind}`, { row });
  }
}
for (const t of levels) {
  for (const row of t.rows as { level: number }[]) {
    const hit = (t.existing as (Row & { level: number })[]).find((r) => r.level === row.level);
    if (hit) updated++;
    else created++;
    if (!apply) continue;
    await call('PUT', `/${t.kind}/${row.level}`, { row, ...(hit ? { rowVersion: hit.rowVersion } : {}) });
  }
}
console.log(apply ? '反映した' : '予定(未反映。apply を付けると反映)', { created, updated });
if (apply) console.log('反映後:', counts(await call('GET', '')));
await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
