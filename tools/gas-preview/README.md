# tools/gas-preview — GAS版との見比べハーネス

GAS版の画面(`legacy/gas-childcare-visit-app/gas-childcare-visit-app/index.html`)をローカルで動かし、
新アプリ(`packages/web`)と**同じ場面・同じデータ**で撮影して横に並べる。見た目・文言をGAS版と
揃える作業は、ここで撮った画像の「差分」が黒くなるまで直す、という進め方をする。

## しくみ

- **GAS版**: `src/gasServer.ts` が `index.html` を返す(submoduleのファイルは書きかえない)。返すときに
  - Tailwind Play CDN の `<script>` を、同じ Tailwind v3 で事前に作ったCSS(`src/gasCss.ts`)に差しかえる
    (CDNにはこの環境から届かないことがあるため。Play CDN も既定テーマなので結果は同じ)。
  - `google.script.run` をモック(`browser/google-script-run-mock.js`)に置きかえる。呼ばれた関数は
    `POST /__gas/run/<関数名>` で `src/gasMock.ts` に届き、GAS版のサーバー関数と同じ形の値を返す。
    出勤簿の週間予定・日ごとの集計・月合計は、GAS版の `PastSchedule.js` / `AttendanceCalc.js` の関数を
    `node:vm` でそのまま動かして作る(`src/gasRuntime.ts`)。
- **新アプリ**: Vite の開発サーバーを Playwright で開き、`/api/**` を `src/webMock.ts` のモックで返す
  (`--web-mode mock`、既定)。応答は `@katahimo/shared` の契約(zod)で検証するので、契約とずれたら気づける。
  `--web-mode live` にすると実際のAPIにログインして撮る(データはDBの内容になる)。
- **データ**: `src/fixtures.ts`(架空の人物・住所)。GAS版・新アプリのモックはどちらもここから応答を作る。
  予定・出勤簿の日付は「今日」からの相対で作り、撮影時は「今日」を 2026-09-25(金)10:00 JST に固定する
  (Playwright の clock。`src/dates.ts`)。
- **フォント**: Google Fonts は Node 側で取得して `.cache/fonts/` にためてから返す(`src/fontCache.ts`)。
  2回目以降はネットに出ないので、撮影のたびに結果が揺れない。
- 画面の大きさは 390×844(iPhone 相当、2倍解像度)。

## 使い方

```bash
# 新アプリの開発サーバー(別のターミナル)。mock モードなら API サーバーは不要
pnpm --filter @katahimo/web dev

# 全場面を撮る → tools/gas-preview/out/<場面>.png(GAS版 | 新アプリ | 差分 の3列)
pnpm --filter @katahimo/gas-preview shoot

# 名前(正規表現)で絞る・一覧を見る・片方だけ撮る
pnpm --filter @katahimo/gas-preview shoot -- --only '^settings'
pnpm --filter @katahimo/gas-preview shoot -- --list
pnpm --filter @katahimo/gas-preview shoot -- --target gas      # out/<場面>.gas.png だけ

# 実際のAPIで撮る(API :8080 と web :5173 を起動しておく。既定は開発用seedの demo / admin@example.com / admin1234)
pnpm --filter @katahimo/gas-preview shoot -- --web-mode live --only shell

# GAS版を手で触る(モックのパスワードは password、再設定の番号は 123456)
pnpm --filter @katahimo/gas-preview serve     # http://127.0.0.1:5180/?as=admin | ?as=staff | ?as=none
```

出力(`out/`)とフォントのキャッシュ(`.cache/`)は `.gitignore` 済み。各場面について
`<場面>.gas.png` / `<場面>.web.png` / 並べた `<場面>.png` ができ、コンソールに「違う画素の割合」が出る
(わずかな色の差は数えない。まだ作っていない部分は `hide` で消して比べない)。

オプション: `--web-url`(既定 `http://127.0.0.1:5173`、環境変数 `KATAHIMO_WEB_URL`)、`--gas-port`(既定 5180)、
`--width` / `--height`。live モードのログイン情報は `KATAHIMO_LIVE_TENANT` / `KATAHIMO_LIVE_EMAIL` / `KATAHIMO_LIVE_PASSWORD`。

Chromium はこの環境に入っているもの(`PLAYWRIGHT_BROWSERS_PATH`、既定 `/opt/pw-browsers`、revision 1194)を使う。
`playwright-core` はそれに合わせて 1.56 系に固定している。`playwright install` はしない。

## 場面を足す

`src/shots/<機能>.ts` に `Shot` の配列を書き、`src/shots/index.ts` に1行足す(機能ごとにファイルを分け、
担当ごとに自分のファイルだけを編集する)。

```ts
import { type Shot, visible } from './types';

export const scheduleShots: Shot[] = [
  {
    name: 'schedule-today',
    title: '今日の予定(ルートつき)',
    fullPage: true,
    // 文言がGAS版と同じなら、操作は両方に共通で書ける(GAS版は閉じたダイアログもDOMに残るので visible で絞る)
    run: async (page) => {
      await page.getByRole('button', { name: '🌙 明日' }).filter(visible).click();
    },
    gas: { mock: { delays: { getRouteForStaffOnDate: 'never' } } }, // GAS版だけ「読み込み中」にする等
    web: { mock: { 'GET /api/schedule/route': { delayMs: 'never' } } },
  },
];
```

- `login`: `'admin'`(既定)/ `'staff'` / `'none'`、`textSize`: `'normal'` / `'large'` / `'xlarge'`
- `gas.mock`: `delays`(関数名 → ミリ秒 or `'never'`)・`failures`(関数名 → withFailureHandler に渡す文言)・`overrides`(関数名 → 戻り値)
- `web.mock`: `'GET /api/…'` → `{ status?, body?, delayMs? }`(`body` を書くとモックの代わりにその応答を返す)
- `gas.run` / `web.run`: 片方だけ違う操作が必要なとき。`hide`: 見比べない部分(まだ作っていない部分など)を消すCSSセレクタ、`mask`: 塗りつぶす部分。`enabled: false` で撮らない。
- `confirm()` / `alert()` は自動で「OK」を押す。

## モックを足す

- **GAS版**: `src/gasMock.ts` の `gasHandlers` に関数名で足す。戻り値はGAS版サーバー関数の `return` と同じ形にする
  (例外を投げると withFailureHandler に渡る)。モックの無い関数が呼ばれるとログに出る。
  いまは index.html が呼ぶ全関数(ログイン・顧客・予定・出勤簿・日報・領収書・設定)が入っている。
- **新アプリ**: `src/webMock.ts` の `webHandlers` に `'GET /api/…'` のキーで足す(`:id` などはパスの一部に使える)。
  応答には契約のスキーマ(`schema`)を付けて検証する。モックの無いAPIは 404 を返してログに出る。
  いまは土台のAPI(認証・スタッフ一覧・データ版数・UI設定・管理者設定)だけが入っている。
- **データ**: `src/fixtures.ts`。GAS版の形で持っているので、新アプリの形への変換は `webMock.ts` 側で書く。

## 日報ダイアログの場面(`src/shots/report.ts`)

お客様タブ・予定タブを通らずに開く: GAS版は `openModal(allCustomers[0])` / `openStandaloneReceiptModal()`、新アプリは
開発サーバーだけにある `window.__katahimoReport.openReport(...)` / `.openStandaloneReceipt()`。領収書の写真は
場面の中で作ったPNGを `#galleryInput` に入れる。書きかけの日報の復元は、ハーネスの初期化(localStorage のクリア)の
あとに入れる init script を足して読み込み直して撮る。

ポートを変えて撮る(並行して別の開発サーバーを動かしているとき)は環境変数で:
`KATAHIMO_WEB_URL=http://127.0.0.1:5321 GAS_PREVIEW_PORT=5192`(pnpm 11 では `pnpm … shoot -- --only …` の
`--` がそのまま渡り、うしろのオプションが効かないため、`cd tools/gas-preview && npx tsx src/shoot.ts --only '^report-'` のように直接動かす)。
新アプリの開発サーバーの中継先は `KATAHIMO_API_PROXY_TARGET=http://localhost:8521 pnpm --filter @katahimo/web exec vite --port 5321`。

## 分かっている違い(GAS版の不具合などで、新アプリでは再現していないもの)

- GAS版は未ログインでも顧客データの版数を確かめ、版数が変わっていると顧客一覧をセッション無しで読み直して
  「うまくいきませんでした…」が出る。見比べの邪魔になるため、未ログインの場面ではGAS版のモックの版数を `'0'` にしている。
- 起動直後、GAS版は版数の確認が顧客一覧より先に返ると「新しい情報があります…」を出すことがある。これを避けるため
  GAS版モックの `checkAndImportLatestCsv` を 800ms 遅らせている。
