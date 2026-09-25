import { startGasServer } from './gasServer';

/** GAS版の画面を手で開いて確かめるためのサーバー(pnpm --filter @katahimo/gas-preview serve)。 */
const port = Number(process.env.GAS_PREVIEW_PORT ?? 5180);
const { url } = await startGasServer(port);
console.log(`GAS版プレビュー: ${url}?as=admin  (管理者としてログイン済み)`);
console.log(`                 ${url}?as=staff  (一般スタッフとしてログイン済み)`);
console.log(`                 ${url}?as=none   (未ログイン。モックのパスワードは password)`);
