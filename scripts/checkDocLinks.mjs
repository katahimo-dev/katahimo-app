// 資料(git 管理と未追跡の *.md。legacy/・.gitignore の対象を除く)の相対リンクのリンク切れと、mermaid のブロックの形を確かめる。
// 使い方: pnpm docs:check(リンク切れ・閉じていない・種類の分からない mermaid があれば終了コード1)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.md'], {
  cwd: root,
  encoding: 'utf8',
})
  .split('\0')
  .filter((f) => f && !f.startsWith('legacy/') && existsSync(join(root, f)));

const MERMAID_TYPES =
  /^(flowchart|graph|sequenceDiagram|erDiagram|stateDiagram(-v2)?|classDiagram|gantt|journey)\b/;
const problems = [];
let links = 0;
let diagrams = 0;

for (const file of new Set(files)) {
  const text = readFileSync(join(root, file), 'utf8');
  const lines = text.split('\n');
  let fence = null;
  lines.forEach((line, i) => {
    const where = `${file}:${i + 1}`;
    const open = /^(\s*)```(\S*)/.exec(line);
    if (open) {
      if (fence === null) {
        fence = { lang: open[2], line: i + 1, first: null };
      } else {
        if (fence.lang === 'mermaid') {
          diagrams++;
          if (!fence.first || !MERMAID_TYPES.test(fence.first)) {
            problems.push(`${file}:${fence.line}: mermaid の種類が分かりません(${fence.first ?? '空'})`);
          }
        }
        fence = null;
      }
      return;
    }
    if (fence) {
      if (fence.first === null && line.trim()) fence.first = line.trim();
      return;
    }
    for (const match of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      links++;
      const path = decodeURIComponent(target.split('#')[0]);
      if (!existsSync(resolve(dirname(join(root, file)), path)))
        problems.push(`${where}: リンク切れ ${target}`);
    }
  });
  if (fence) problems.push(`${file}:${fence.line}: コードブロックが閉じていません`);
}

for (const p of problems) console.error(p);
console.log(
  `資料 ${files.length} 件・相対リンク ${links} 件・mermaid ${diagrams} 件を確かめました(問題 ${problems.length} 件)`,
);
if (problems.length > 0) process.exitCode = 1;
