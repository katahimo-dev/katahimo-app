import { isAbsolute, resolve } from 'node:path';

/**
 * 運用スクリプトのコマンドライン引数。pnpm 11 は `pnpm <script> -- <引数>` の `--` もそのまま渡すため取り除く。
 */
export function cliArgs(argv: readonly string[] = process.argv): string[] {
  return argv.slice(2).filter((a) => a !== '--');
}

/**
 * `--name 値` の形のオプションを取り出す(残りの引数と、見つかった値)。値が無ければ undefined。
 */
export function takeOption(args: string[], name: string): { rest: string[]; value: string | undefined } {
  const index = args.indexOf(name);
  if (index < 0) return { rest: args, value: undefined };
  return { rest: args.filter((_, i) => i !== index && i !== index + 1), value: args[index + 1] };
}

/** `--name 値` を何回でも取り出す(残りの引数と、見つかった値の並び)。値の無い最後の `--name` は値 undefined。 */
export function takeRepeatedOption(
  args: string[],
  name: string,
): { rest: string[]; values: (string | undefined)[] } {
  const rest: string[] = [];
  const values: (string | undefined)[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      values.push(args[i + 1]);
      i++;
    } else {
      rest.push(args[i] as string);
    }
  }
  return { rest, values };
}

/**
 * 入力ファイルのパス。`pnpm --filter @katahimo/api <script>` はパッケージのフォルダで動くため、相対パスは
 * コマンドを打ったフォルダ(pnpm が INIT_CWD に入れる)から解決する。
 */
export function resolveInputPath(
  path: string,
  baseDir: string = process.env.INIT_CWD ?? process.cwd(),
): string {
  return isAbsolute(path) ? path : resolve(baseDir, path);
}
