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
- **新アプリ**: Vite の開発サーバー(`src/webServer.ts` がこのプロセスの中で起動する。`--web-url` を指定したときは
  そのURLで動いているサーバーを使う)を Playwright で開き、`/api/**` を `src/webMock.ts` のモックで返す
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
# 全場面を撮る → tools/gas-preview/out/<場面>.png(GAS版 | 新アプリ | 差分 の3列)
# 新アプリの Vite もこのコマンドが起動して、終わったら止める(mock モードなら API サーバーは不要)
pnpm --filter @katahimo/gas-preview shoot

# すでに動いている開発サーバーを使う(pnpm --filter @katahimo/web dev を別のターミナルで起動しておく)
pnpm --filter @katahimo/gas-preview shoot -- --web-url http://127.0.0.1:5173

# 名前(正規表現)で絞る・一覧を見る・片方だけ撮る
pnpm --filter @katahimo/gas-preview shoot -- --only '^settings'
pnpm --filter @katahimo/gas-preview shoot -- --list
pnpm --filter @katahimo/gas-preview shoot -- --target gas      # out/<場面>.gas.png だけ

# 実際のAPIで撮る(API --api-url(既定 :8080)を起動しておく。既定は開発用seedの demo / admin@example.com / admin1234)
pnpm --filter @katahimo/gas-preview shoot -- --web-mode live --only shell

# GAS版を手で触る(モックのパスワードは password、再設定の番号は 123456)
pnpm --filter @katahimo/gas-preview serve     # http://127.0.0.1:5180/?as=admin | ?as=staff | ?as=none
```

出力(`out/`)とフォントのキャッシュ(`.cache/`)は `.gitignore` 済み。各場面について
`<場面>.gas.png` / `<場面>.web.png` / 並べた `<場面>.png` ができ、コンソールに「違う画素の割合」が出る
(わずかな色の差は数えない。まだ作っていない部分は `hide` で消して比べない)。最後に「撮れなかった場面」と
「差分が `--max-diff`(既定 0.05%)を越えた場面」の一覧を出し、1つでもあれば終了コード1で終わる(CIでそのまま使える)。
1つの場面で失敗しても、ほかの場面は撮り続ける。

オプション: `--web-url`(指定すると Vite を起動せず、そのURLのサーバーを使う。環境変数 `KATAHIMO_WEB_URL`)、
`--api-url`(起動する Vite の `/api` の中継先。live モード用。既定 `WEB_API_PROXY_TARGET` または `http://localhost:8080`)、
`--max-diff`(既定 0.05)、`--concurrency`(同時に撮る場面の数。既定 2)、`--gas-port`(既定 5180)、`--width` / `--height`。
起動する Vite のポートは `WEB_DEV_PORT`(既定: 空いているポート)。
live モードのログイン情報は `KATAHIMO_LIVE_TENANT` / `KATAHIMO_LIVE_EMAIL` / `KATAHIMO_LIVE_PASSWORD`。

撮る前は、通信(networkidle)・フォント・CSSの移り変わり(フェード)が終わるまで待ち、読み込み中のくるくるのような
くり返す動きは初めの形で止めて撮る(Playwright の `animations: 'disabled'`)。場面の中の時刻は Node の時計ではなく
撮影の時計(`DEFAULT_NOW_ISO`)から作る(GAS版と新アプリを撮る間に分が変わってもずれないように)。

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
  いまは新アプリが呼ぶ全API(認証・予定・お客様・出勤簿・日報・領収書・設定)が入っている。
- **データ**: `src/fixtures.ts`。GAS版の形で持っているので、新アプリの形への変換は `webMock.ts` 側で書く。
- **localStorage**: 新アプリは使う人の値(書きかけの日報・最近のお客様など)をログインしている人ごとのキーに持つ。場面の中で
  入れるときは `shots/types.ts` の `userStorageKey(target, 'pending_report_draft')` を使う(GAS版はキー名そのまま)。

## 日報ダイアログの場面(`src/shots/report.ts`)

お客様タブ・予定タブを通らずに開く: GAS版は `openModal(allCustomers[0])` / `openStandaloneReceiptModal()`、新アプリは
開発サーバーだけにある `window.__katahimoReport.openReport(...)` / `.openStandaloneReceipt()`。領収書の写真は
場面の中で作ったPNGを `#galleryInput` に入れる。書きかけの日報の復元は、ハーネスの初期化(localStorage のクリア)の
あとに入れる init script を足して読み込み直して撮る。

ポートを変えて撮る(並行して別の開発サーバーを動かしているとき)は環境変数で:
`WEB_DEV_PORT=5321 GAS_PREVIEW_PORT=5192`(起動済みのサーバーを使うなら `KATAHIMO_WEB_URL=http://127.0.0.1:5321`)。pnpm 11 は `pnpm … shoot -- --only …` の `--` も
そのまま渡すが、`shoot.ts` / `e2e.ts` は `--` を取り除いてからオプションを読むので、そのまま効く
(`cd tools/gas-preview && npx tsx src/shoot.ts --only '^report-'` のように直接動かしてもよい)。
新アプリの開発サーバーのポート・中継先は `WEB_DEV_PORT=5321 WEB_API_PROXY_TARGET=http://localhost:8521 pnpm --filter @katahimo/web dev`。

## 通し確認(`src/e2e.ts`、実際のAPI・DB)

見比べ(モック)とは別に、実際のAPI・DBにつないだ新アプリを 390×844 で最初から最後まで操作し、機能どうしを
つないだときに壊れていないかを確かめる。手順ごとの画面を `out/e2e/<番号>-<手順>.png` に保存し、成否の表を出す
(1つでも失敗すると終了コード1)。手順の中で出たブラウザのエラー・5xx 応答も失敗として数える。

```bash
# 前提: pnpm db:migrate && pnpm db:seed 済み。API(--api-url、既定 :8080)が動いていなければこのコマンドが起動し、
# 新アプリの Vite もこのコマンドの中で起動する(終わったら両方止める)
pnpm --filter @katahimo/gas-preview e2e      # または cd tools/gas-preview && npx tsx src/e2e.ts
# 本番ビルド(API が WEB_DIST_DIR のWeb画面を配信)で確かめる
npx tsx src/e2e.ts --web-url http://127.0.0.1:8484
# 手順を名前(正規表現)で絞る(ログインは前提になるため一緒に指定する)
npx tsx src/e2e.ts --only '^(login|customers-search|logout)$'
```

手順: ログイン(demo 管理者)→ 今日の予定(noop なら 📭)→ お客様を探す → お客様の情報 → これまでの記録 →
日報を書く(メモ → AIに書いてもらう → キー未設定の知らせ。AIが使えないと画面からは保存できない(GAS版と同じ)ため、
保存は同じ内容を `POST /api/reports/daily` で行う)→ 領収書を送る(canvas で作った JPEG)→ お客様に関係ない領収書 →
出勤簿(週の一覧/表・今日を開く・1件目の訪問を保存・天候を切り替えて保存・今月のまとめ)→ 設定(文字の大きさ・
詳細設定)→ ログアウト → 一般スタッフ(`POST /api/admin/staff` で「e2e 一般スタッフ」を作る。既にあれば使い回す)で
管理者向けの表示が無いこと・管理者APIが403になること・他人の `staffId` を指定しても本人のデータになることを確かめる。

- 保存できたかはお知らせの文言ではなくAPIの応答で確かめる(直前の手順のお知らせが4秒残るため)。
- 日報・領収書・出勤簿(今日の1件目の訪問・天候)に書き込む。開発用DBでだけ動かすこと。何度流しても同じ結果になる
  ように書いてある(天候は選ばれていないほうを押す)。
- ログイン情報は `--tenant` / `--email` / `--password`(環境変数 `KATAHIMO_LIVE_TENANT` 等でもよい)。

## 分かっている違い(GAS版の不具合などで、新アプリでは再現していないもの)

- GAS版は未ログインでも顧客データの版数を確かめ、版数が変わっていると顧客一覧をセッション無しで読み直して
  「うまくいきませんでした…」が出る。見比べの邪魔になるため、未ログインの場面ではGAS版のモックの版数を `'0'` にしている。
- 起動直後、GAS版は版数の確認が顧客一覧より先に返ると「新しい情報があります…」を出すことがある。これを避けるため
  GAS版モックの `checkAndImportLatestCsv` を 800ms 遅らせている。
