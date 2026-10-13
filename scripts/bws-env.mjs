#!/usr/bin/env node
/**
 * bws-env.mjs — Bitwarden Secrets Manager から環境変数を注入してコマンドを実行する
 *
 * 1プロジェクトに複数アプリを接頭辞で同居させる前提。実行時に接頭辞を剥がす。
 * `__FILE` で終わるシークレットは base64 として一時ファイルに展開し、そのパスを環境変数に入れる。
 *
 * 使い方（引数はすべて名前付き。PowerShell が空文字引数を落とす問題を避けるため）:
 *   node scripts/bws-env.mjs --project <ID> [--prefix <P>] [--token-env <NAME>] [--debug] -- <command...>
 *
 * 例:
 *   node scripts/bws-env.mjs --project 313221bc-... --token-env BWS_TOKEN_KATAHIMO -- pnpm dev:raw
 *   node scripts/bws-env.mjs --project 057e4569-... --prefix UNITCALC__ --token-env BWS_TOKEN_APPS -- npx expo start
 *
 * 注意: トークンは bws の呼び出しだけに渡し、子プロセス（アプリ本体）には渡さない。
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const USAGE =
  "usage: bws-env.mjs --project <ID> [--prefix <P>] [--token-env <NAME>] [--debug] -- <command...>";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep === -1) {
  console.error(USAGE);
  console.error(`受け取った引数: ${JSON.stringify(argv)}`);
  process.exit(2);
}
const head = argv.slice(0, sep);
const [cmd, ...args] = argv.slice(sep + 1);

const flag = (name, fallback) => {
  const i = head.indexOf(name);
  return i !== -1 && head[i + 1] !== undefined ? head[i + 1] : fallback;
};

// --project 省略時は、フラグでない最初の引数をプロジェクトIDとみなす
const projectId = flag("--project", head.find((a) => !a.startsWith("--")));
const prefix = flag("--prefix", "");
const tokenEnvName = flag("--token-env", "BWS_ACCESS_TOKEN");
const DEBUG = head.includes("--debug");

const diag = () =>
  console.error(
    `[bws-env] project=${projectId} prefix="${prefix}" tokenEnv=${tokenEnvName} ` +
      `tokenLen=${(process.env[tokenEnvName] ?? "").length} argv=${JSON.stringify(head)}`
  );

if (DEBUG) diag();

if (!projectId || !cmd) {
  console.error(USAGE);
  diag();
  process.exit(2);
}

const token = (process.env[tokenEnvName] ?? "").trim();
if (!token) {
  console.error(`環境変数 ${tokenEnvName} が未設定、または空`);
  console.error("新しいターミナルを開いたか確認（ユーザー環境変数は既存セッションに反映されない）");
  diag();
  process.exit(1);
}

// bws に渡す環境。Windows の環境変数は大文字小文字を区別しないので、
// 既存の BWS_ACCESS_TOKEN を綴り違いも含めて取り除いてから入れ直す。
const bwsEnv = {};
for (const [k, v] of Object.entries(process.env)) {
  if (k.toUpperCase() === "BWS_ACCESS_TOKEN") continue;
  bwsEnv[k] = v;
}
bwsEnv.BWS_ACCESS_TOKEN = token;

let secrets;
try {
  secrets = JSON.parse(
    execFileSync("bws", ["secret", "list", projectId, "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 32 * 1024 * 1024,
      env: bwsEnv,
    })
  );
} catch (e) {
  console.error(`bws secret list に失敗`);
  diag();
  if (e?.status !== undefined) console.error(`終了コード: ${e.status}`);
  process.exit(1);
}

// 子プロセスに渡す環境を組み立てる
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/^BWS_/i.test(k)) continue;            // トークン類はアプリに渡さない
  if (/^[A-Z0-9]+__/.test(k)) continue;      // 他アプリの接頭辞付き変数は渡さない
  env[k] = v;
}

let tmp = null;
let n = 0;
for (const s of secrets) {
  if (prefix && !s.key.startsWith(prefix)) continue;
  let name = s.key.slice(prefix.length);
  if (!prefix && /^[A-Z0-9]+__/.test(name)) continue; // 接頭辞なし運用では他アプリ分を拾わない

  if (name.endsWith("__FILE")) {
    name = name.slice(0, -"__FILE".length);
    tmp ??= mkdtempSync(join(tmpdir(), "bwsenv-"));
    const ext = /JSON$/.test(name) ? ".json"
              : /KEYSTORE|JKS/.test(name) ? ".jks"
              : ".bin";
    const p = join(tmp, name.toLowerCase() + ext);
    writeFileSync(p, Buffer.from(s.value, "base64"), { mode: 0o600 });
    env[name] = p;
  } else {
    env[name] = s.value;
  }
  n++;
}

if (n === 0) {
  console.error(`接頭辞 "${prefix}" に一致するシークレットが0件`);
  console.error(`このプロジェクトのキー: ${secrets.map((s) => s.key).join(", ") || "(なし)"}`);
  process.exit(1);
}
console.error(`[bws-env] ${n} 件を注入${prefix ? ` (${prefix})` : ""}`);

const cleanup = () => { if (tmp) rmSync(tmp, { recursive: true, force: true }); };
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

// shell:true と引数配列の併用は非推奨(DEP0190)。自前で引用符を付けて1行にする。
const quote = (a) => (/[\s"^&|<>()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const line = [cmd, ...args].map(quote).join(" ");

spawn(line, { env, stdio: "inherit", shell: true })
  .on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
