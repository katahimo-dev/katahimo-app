import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * テスト専用: GAS版(legacy/gas-childcare-visit-app サブモジュール)のソースから指定した
 * トップレベル宣言(function / const)だけを切り出し、Nodeのvm上で実行できるようにする。
 *
 * 移植したTypeScript実装とGAS版のコードそのものに同じ入力を与えて出力を突き合わせるための仕組み
 * (「GAS版を読んで同じつもりで書いた」ではなく、実際に同じ結果になることを確かめる)。
 * サブモジュールが取得されていない環境では GAS_LEGACY_AVAILABLE が false になり、比較テストは
 * スキップされる。
 */

const GAS_SOURCE_DIR = fileURLToPath(
  new URL('../../../../legacy/gas-childcare-visit-app/gas-childcare-visit-app/', import.meta.url),
);

export const GAS_LEGACY_AVAILABLE = existsSync(`${GAS_SOURCE_DIR}PastSchedule.js`);

/** source[start] の開き括弧に対応する閉じ括弧の位置(文字列・行コメントの中は数えない)。 */
function findMatchingBracket(source: string, start: number): number {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      for (i++; i < source.length && source[i] !== ch; i++) {
        if (source[i] === '\\') i++;
      }
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('対応する括弧が見つかりません');
}

/** トップレベルの `function name(...) {...}` または `const name = ...;` の宣言部分を切り出す。 */
function extractDeclaration(source: string, name: string): string {
  const fnMatch = new RegExp(`^function ${name}\\(`, 'm').exec(source);
  if (fnMatch) {
    const bodyStart = source.indexOf('{', source.indexOf(')', fnMatch.index));
    return source.slice(fnMatch.index, findMatchingBracket(source, bodyStart) + 1);
  }
  const constMatch = new RegExp(`^const ${name} = `, 'm').exec(source);
  if (constMatch) {
    const valueStart = constMatch.index + constMatch[0].length;
    const opener = source[valueStart];
    if (opener !== '{' && opener !== '[') {
      return source.slice(constMatch.index, source.indexOf(';', valueStart) + 1);
    }
    return `${source.slice(constMatch.index, findMatchingBracket(source, valueStart) + 1)};`;
  }
  throw new Error(`GAS版のソースに宣言が見つかりません: ${name}`);
}

// biome-ignore lint/suspicious/noExplicitAny: GAS版の関数は型を持たないため
export type GasFunctions = Record<string, (...args: any[]) => any>;

/**
 * 指定ファイルから指定の宣言を切り出して1つのスクリプトとして実行し、関数・定数を返す。
 * 宣言は列挙した順に連結するため、依存される定数を先に書くこと。
 */
export function loadGasDeclarations(
  files: Record<string, string[]>,
  globals: Record<string, unknown> = {},
): GasFunctions {
  const parts: string[] = [];
  const names: string[] = [];
  for (const [file, declarations] of Object.entries(files)) {
    const source = readFileSync(`${GAS_SOURCE_DIR}${file}`, 'utf8');
    for (const name of declarations) {
      parts.push(extractDeclaration(source, name));
      names.push(name);
    }
  }
  parts.push(`globalThis.__gasExports = { ${names.join(', ')} };`);
  const context: Record<string, unknown> = {
    // isSamePastScheduleValue_ 等が Date セルの場合にだけ使う。テストでは Date を渡さない。
    Utilities: { formatDate: () => '' },
    // 切り出さなかった関数・GAS のサービスの代わり(テストが渡す)
    ...globals,
  };
  vm.createContext(context);
  new vm.Script(parts.join('\n\n')).runInContext(context);
  return context.__gasExports as GasFunctions;
}
