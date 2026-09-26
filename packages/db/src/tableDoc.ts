/**
 * テーブル定義書(doc/03_付録_テーブル定義.md)を、マイグレーション済みの DB のカタログと schema/*.ts の
 * JSDoc から作り直す(pnpm db:doc)。列・制約・索引・トリガー・RLS・権限は DB を正とし、説明だけを
 * スキーマの JSDoc から取る(手で書いた表がスキーマとずれないように)。
 */

/** テーブルごとの説明と、列(snake_case)ごとの説明。 */
export interface SchemaDocs {
  [table: string]: { doc: string; columns: Record<string, string> };
}

const snakeCase = (name: string) => name.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** JSDoc(`/** … *\/`)を文にする(折り返しはつなげ、`- ` で始まる行は箇条書きとして改行を残す)。 */
function jsdocText(comment: string): string {
  return comment
    .trim()
    .replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .map((line) => (line.startsWith('- ') ? `\n${line}` : line))
    .join('')
    .trim();
}

/** schema/*.ts の1ファイルから、`pgTable('名前', { … })` / `platform.table(…)` の JSDoc を読む。 */
export function parseSchemaDocs(source: string): SchemaDocs {
  const docs: SchemaDocs = {};
  const tableRe =
    /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?export const \w+ = (?:pgTable|platform\.table)\(\s*'(\w+)',\s*\{([\s\S]*?)\n {2}\},/g;
  for (const match of source.matchAll(tableRe)) {
    const [, tableDoc, table, body] = match;
    if (!table || body === undefined) continue;
    const columns: Record<string, string> = {};
    let pending: string | null = null;
    let inComment = false;
    for (const line of body.split('\n')) {
      if (inComment || /^\s*\/\*\*/.test(line)) {
        pending = inComment ? `${pending}\n${line}` : line;
        inComment = !/\*\/\s*$/.test(line);
        continue;
      }
      const column = /^ {4}(\w+): /.exec(line)?.[1];
      if (column && pending) columns[snakeCase(column)] = jsdocText(pending);
      if (/^\s*\/\//.test(line)) continue;
      pending = null;
    }
    docs[table] = { doc: tableDoc ? jsdocText(tableDoc) : '', columns };
  }
  return docs;
}

/** 制約の定義を読みやすくする(`= ANY (ARRAY[…])` → `IN (…)`、型の注記を省く)。 */
export function simplifyDefinition(definition: string): string {
  return definition
    .replace(/\s+/g, ' ')
    .replace(/= ANY \(ARRAY\[([^\]]*)\]\)/g, 'IN ($1)')
    .replace(/::(text|date|timestamp with time zone|integer|jsonb|text\[\])\b/g, '');
}

const cell = (value: unknown) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

export interface TableCatalog {
  schema: string;
  name: string;
  rls: boolean;
  force: boolean;
  columns: { name: string; type: string; notNull: boolean; default: string | null }[];
  constraints: { name: string; type: string; definition: string }[];
  indexes: { name: string; definition: string }[];
  triggers: string[];
  policies: string[];
  grants: Record<string, string>;
}

const CONSTRAINT_KIND: Record<string, string> = { p: 'PK', u: 'UNIQUE', f: 'FK', c: 'CHECK', x: 'EXCLUDE' };
/** どのテーブルにもある tenant_id → platform.tenants の FK(一覧では省く)。 */
const TENANT_FK = /^FOREIGN KEY \(tenant_id\) REFERENCES platform\.tenants\(id\) ON DELETE CASCADE$/;

/** 1テーブル分の Markdown。 */
export function renderTable(table: TableCatalog, docs: SchemaDocs[string] | undefined): string {
  const name = table.schema === 'public' ? table.name : `${table.schema}.${table.name}`;
  const lines = [`### \`${name}\``, ''];
  if (docs?.doc) lines.push(docs.doc, '');
  lines.push('| 列 | 型 | NULL | 既定値 | 説明 |', '| --- | --- | --- | --- | --- |');
  for (const c of table.columns) {
    const type = c.type.replace('timestamp with time zone', 'timestamptz');
    const def = c.default ? `\`${cell(simplifyDefinition(c.default))}\`` : '';
    lines.push(
      `| \`${c.name}\` | ${cell(type)} | ${c.notNull ? '' : '可'} | ${def} | ${cell(docs?.columns[c.name])} |`,
    );
  }
  lines.push('');
  const constraints = table.constraints
    .filter((k) => !(k.type === 'f' && TENANT_FK.test(k.definition)))
    .map(
      (k) =>
        `- ${CONSTRAINT_KIND[k.type] ?? k.type} \`${k.name}\`: \`${cell(simplifyDefinition(k.definition))}\``,
    );
  const indexes = table.indexes.map((i) => {
    const unique = /^CREATE UNIQUE INDEX/.test(i.definition) ? 'UNIQUE ' : '';
    const body = i.definition.replace(/^CREATE (UNIQUE )?INDEX \S+ ON (?:ONLY )?\S+ /, '');
    return `- ${unique}INDEX \`${i.name}\`: \`${cell(body)}\``;
  });
  if (constraints.length || indexes.length) lines.push('制約・索引:', '', ...constraints, ...indexes, '');
  const notes: string[] = [];
  if (table.triggers.length) notes.push(`トリガー: ${table.triggers.map((t) => `\`${t}\``).join('、')}`);
  const policies = table.policies.length ? `(${table.policies.map((p) => `\`${p}\``).join('・')})` : '';
  notes.push(`RLS: ${table.rls ? (table.force ? 'FORCE' : '有効') : 'なし'}${policies}`);
  notes.push(`権限: app=${table.grants.katahimo_app ?? '—'} / worker=${table.grants.katahimo_worker ?? '—'}`);
  lines.push(`${notes.join('。')}。`, '');
  return lines.join('\n');
}
