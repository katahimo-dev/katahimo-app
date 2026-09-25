# @katahimo/web(スタッフ用Webアプリ)

GAS版 `gas-childcare-visit-app` の画面(`legacy/gas-childcare-visit-app/gas-childcare-visit-app/index.html`)を、
見た目・文言・操作の流れを変えずに React + TypeScript で作り直したもの。**GAS版が正**であり、迷ったら
GAS版のマークアップ・クラス名・文言・`<script>` の処理をそのまま再現する(`tools/gas-preview` で並べて撮影して確かめる)。

## 動かし方

```bash
# 1. API(:8080)。DBは .env の DATABASE_URL(ローカルPostgreSQL)。初回は pnpm db:migrate && pnpm db:seed
pnpm --filter @katahimo/api dev

# 2. 画面(:5173)。/api は Vite が :8080 へ中継する(本番と同じ同一オリジン・Cookie認証)
pnpm --filter @katahimo/web dev
```

開発用seedでは法人ID `demo`、`admin@example.com` / `admin1234` でログインできる。

```bash
pnpm --filter @katahimo/web build   # 本番ビルド(dist/)
pnpm typecheck && pnpm test && pnpm lint   # リポジトリ全体(ルートで実行)
```

### 法人ID(テナント)の決め方

GAS版は1法人専用のためログイン画面に法人を選ぶ欄が無い。見た目を揃えるため、次の順で法人IDを決め、
**どれでも決まらないときだけ**ログイン画面に「法人ID」欄を出す(`src/lib/tenant.ts`)。

1. ビルド時の既定値 `VITE_DEFAULT_TENANT_SLUG`(1法人向けの本番ビルドではこれを設定する)
2. URL — `?t=<法人ID>`、または `VITE_TENANT_BASE_DOMAIN` を設定した場合のサブドメイン(`<法人ID>.<ベースドメイン>`)
3. このブラウザで最後にログインできた法人ID(localStorage)

設定例は `.env.example`。

## 使っているもの

- React 18 / TypeScript / Vite 6 / TanStack Query 5 / vite-plugin-pwa
- **Tailwind CSS v3.4**(PostCSS)。GAS版は Tailwind Play CDN(v3系・設定なし)を使っているため、v4ではなく
  同じv3系を既定テーマのまま使う(v4は `bg-opacity-*` の廃止や影・角丸の段階の変更があり、GAS版の
  クラス名をそのまま書いても同じ見た目にならない)。**GAS版と同じクラス名を書けば同じ見た目になる**。
- フォントはGAS版と同じ Google Fonts(本文 BIZ UDPGothic、見出し・ボタン Zen Maru Gothic)。`index.html` で読む。
- GAS版の `<style>` にあった独自CSS(フォント・`.loading-spinner`・文字の大きさ)は `src/styles/index.css`。
- APIの型・検証は `@katahimo/shared` の zod スキーマ(契約)をそのまま使う。

## フォルダ構成

```
src/
  main.tsx                 入口(描画前に文字の大きさを反映)
  styles/index.css         Tailwind + GAS版の<style>の移植
  app/                     画面の骨格(全機能で共有。変更は土台の担当と相談)
    App.tsx                Provider の組み立て(Query / 文字の大きさ / 確認ダイアログ / ログイン / トースト)
    AppShell.tsx           ヘッダー・3つのタブ・下タブ・設定ダイアログ
    Header.tsx, BottomNav.tsx, homeTabs.tsx(useHomeTabs)
    TextSizeProvider.tsx   useTextSize()
    adminTargetStaff/      管理者用「表示するスタッフ」(予定・出勤簿で共有)
    dataVersion/           顧客データの版数の監視(60秒ごと)
    uiConfig/useUiConfig.ts  GET /api/ui-config(日報画面の文言・評価の定義)
  api/                     APIの呼び出し(1ファイル=1つのAPIのまとまり)
    client.ts              共通の fetch(zodで応答を検証、エラーの種類分け)
    queryKeys.ts           機能をまたいで無効化するクエリキー
    auth.ts, settings.ts, staff.ts, system.ts
  features/                機能ごとのフォルダ(担当ごとに分かれて作業する)
    auth/                  ログイン・パスワード再設定・パスワード変更・セッション
    settings/              設定ダイアログ
    schedule/              「📅 今日の予定」タブ            ← 予定・お客様の担当
    customers/             「👪 お客様」タブ・お客様の情報/これまでの記録  ← 予定・お客様の担当
    report/                日報・事故報告・領収書ダイアログ    ← 日報の担当
    attendance/            「🕒 出勤簿」タブとその中のダイアログ ← 出勤簿の担当
  lib/                     画面に依存しない小さな処理(storage / textSize / tenant / messages)
  ui/                      共通の部品(トースト・確認ダイアログ・フェードするダイアログ・読み込み中・0件表示)
```

## 機能ごとの担当(並行して作業するときのファイルの持ち分)

| 担当 | 持ち分(自由に作り直してよい) | 入口(AppShell が import する。名前を変えない) |
| --- | --- | --- |
| 予定・お客様 | `src/features/schedule/**`、`src/features/customers/**`、`src/api/schedule.ts`、`src/api/customers.ts`、`tools/gas-preview/src/shots/schedule.ts`・`customers.ts` | `ScheduleTab`、`CustomersTab` |
| 日報 | `src/features/report/**`、`src/api/reports.ts`、`src/api/receipts.ts`、`tools/gas-preview/src/shots/report.ts` | `ReportModalProvider`、`useReportModal` |
| 出勤簿 | `src/features/attendance/**`、`src/api/attendance.ts`、`src/api/calendarSync.ts`、`tools/gas-preview/src/shots/attendance.ts` | `AttendanceTab` |

- 他の担当のフォルダは編集しない。共有部分(`app/`・`api/client.ts`・`api/queryKeys.ts`・`lib/`・`ui/`・
  `tools/gas-preview` の共通部分)に手を入れる必要が出たら、最小限の追加にとどめ、既存の関数の形は変えない。
- `tools/gas-preview/src/webMock.ts`(新アプリ用APIモック)・`fixtures.ts` は全員が追記する。追記は自分の
  APIのハンドラーをまとまりで足すだけにし、他の担当の部分は書きかえない。
- **予定→日報**: 予定・お客様タブから日報を開くときは `useReportModal().openReport({ customerId, customerName })`、
  お客様に関係ない領収書は `openStandaloneReceipt()`。この形を変えるときは両担当で相談する。
- **予定→お客様タブへの移動**(GAS版 `jumpToCustomerFromSchedule`)は `useHomeTabs().switchTab('visitors')` を使い、
  検索欄への受け渡しは `features/customers` の中で用意する。
- 出勤簿タブはGAS版と同じく**初めて開いたときに作られる**(`AttendanceTab` の初回描画 = GAS版 `initPastScheduleTab`)。
  タブを切り替えても作り直さない(隠すだけ)ので、入力途中の値は残る。

## 書き方の決まり

- **見た目**: GAS版のクラス名をそのまま使う(`className` に同じ文字列)。GAS版がJSで付け外ししていたクラス
  (例: 選択中のタブの `border-blue-600 text-blue-600`)は、状態に応じて同じクラスを付ける。
  `innerHTML` で文字列を組み立てるGAS版の書き方はしない(JSXで書く)。
- **文言**: GAS版と一字一句同じにする(全角・半角、「…」と「...」の違いも含む)。GAS版で共通の文言は `src/lib/messages.ts`。
- **ダイアログ**: GAS版は `hidden` と `opacity-0` を付け外しして開閉する(開くとき10ms後に不透明、閉じるとき300ms後に隠す)。
  `ui/modal` の `FadeModal`(外側の暗い背景)と `ModalHeader` / `ModalFooter` を使う。外側のクラスはGAS版の外側divのクラスから
  `hidden` / `opacity-0` を除いたものを渡す。z-index はGAS版と同じ値にする(下表)。
- **お知らせ**: `showToast(message, isError)` / `hideToast()`(`ui/toast`)。GAS版と同じく、ふつうは4秒で消え、
  失敗(`isError = true`)は「閉じる」を押すまで消えない。
- **確認**: GAS版が標準の `confirm()` / `alert()` を使っている場所は `confirmNative` / `alertNative`、
  独自の確認ダイアログ(#confirmationModal)を使っている場所は `useConfirmModal()`(`ui/confirm`)。
- **読み込み中・0件・失敗**: `ui/StatusViews.tsx` の `Loading`(「読み込んでいます…」)・`EmptyState`・`ErrorState`。
- **API**: `src/api/<機能>.ts` に `api.get(path, 応答のzodスキーマ, query)` / `api.post(path, スキーマ, body)` で
  呼び出しをまとめ、画面では TanStack Query(`useQuery` / `useMutation`)から使う。応答は必ず契約のスキーマで検証する
  (契約に無い応答を返すAPIは、まず `packages/shared/src/contracts` に契約を足す)。
  - エラーの文言は `userMessageOf(error)`: サーバーが理由を返したらその理由、通信失敗などは
    「うまくいきませんでした。電波を確認して、もう一度押してください」(GAS版の withFailureHandler と同じ)。
  - APIの失敗を赤いお知らせで出すときは `showErrorToast(error)`(`ui/toast`)。401(セッション切れ)は自動でログイン画面に
    戻り「しばらく使っていなかったので、もう一度ログインしてください」を出すため、お知らせは出さない。
- **ログイン中の人**: `useSession().user`(`staffId` / `name` / `isAdmin`)。管理者向けの表示の出し分けは `user.isAdmin`。
- **管理者の「表示するスタッフ」**: タブの一番上に `<AdminTargetStaffSelect id="…" />` を置き、APIには
  `useAdminTargetStaff().requestStaffId` を `staffId` として渡し、クエリキーにも入れる(選び直すと自動で読み直される)。
  管理者以外は `undefined`(= 本人。サーバーも管理者以外の staffId は無視する)。
- **顧客データのクエリ**は `queryKeys.customers.all` で始まるキーにする(新しい顧客CSVが取り込まれたとき、版数の監視が
  まとめて読み直すため)。
- **localStorage**: キーは `src/lib/storage.ts` の `STORAGE_KEYS` に足してから使う。GAS版と同じ意味の値はGAS版と同じキー名。
- **日付**: 業務日は JST の `'YYYY-MM-DD'`(契約の `businessDateSchema`)。
- コメント・コミットメッセージは日本語。

### localStorage のキー

| キー | 中身 | GAS版と同じ |
| --- | --- | --- |
| `app_text_size` | 文字の大きさ `normal` / `large` / `xlarge`(古い `small` / `medium` は `normal` に置きかえる) | ○ |
| `katahimo_last_tenant_slug` | 最後にログインできた法人ID | (新規) |
| `katahimo_session_hint` | ログインしていた印(期限切れの案内を出し分ける。Cookieはスクリプトから読めないため) | (GAS版はトークンの有無で判断) |
| `cal_week_view_mode` / `recent_customers` / `pending_report_draft` / `last_start_hour` / `last_start_minute` / `last_acc_time` / `GAS_RECEIPT_KEYS_V1_*` | 各機能の担当が使う(GAS版と同じ意味・形で) | ○ |

GAS版の `GAS_AUTH_TOKEN` / `GAS_STAFF_SESSION_V3` / `GAS_STAFF_ADMIN` は使わない(ログインは httpOnly Cookie、管理者かどうかは `/api/auth/me`)。

### z-index(GAS版と同じ)

| 値 | ダイアログ |
| --- | --- |
| `z-10` / `z-20` | ヘッダー / 下タブ |
| `z-50` | ログイン、日報・事故報告 |
| `z-[60]` | パスワード再設定、ヒント、お客様の情報、これまでの記録 |
| `z-[70]` | 確認ダイアログ(useConfirmModal) |
| `z-[100]` | 設定 |
| `z-[110]` | パスワード変更、今月のまとめ、まとめて取り込む |
| `z-[115]` | カレンダーとの見比べ |
| `z-[120]` | 予定の修正 |
| `z-[130]` | お知らせ(トースト) |

## GAS版との見比べ(tools/gas-preview)

GAS版の `index.html` をモックの `google.script.run` 付きでローカルに開き、新アプリと同じ場面を同じデータで撮影して
横に並べる。使い方は `tools/gas-preview/README.md`。

```bash
pnpm --filter @katahimo/web dev                       # 別のターミナルで
pnpm --filter @katahimo/gas-preview shoot             # tools/gas-preview/out/<場面>.png
pnpm --filter @katahimo/gas-preview shoot -- --only settings
```

新しい画面を作ったら、`tools/gas-preview/src/shots/<機能>.ts` に場面を足し、差分(3列目)が黒くなるまで直す。

## GAS版と意図的に変えているところ

- ログイン状態は httpOnly Cookie(GAS版はトークンを localStorage に置いていた)。法人IDの欄は上記の条件のときだけ出る。
- GAS版は未ログインでも顧客データの版数を確かめ、失敗のお知らせが出ることがあった。新アプリはログイン後だけ確かめる。
  また顧客CSVの取り込みはサーバーが定期実行するため、画面を開いたときの取り込み(checkAndImportLatestCsv)はしない。
- 設定の詳細設定は1回のAPI(GET /api/settings/admin)で読むため、読み込み中に保存したときの案内は
  「Gemini APIキーの読み込みが完了してから保存してください」の1種類(GAS版は設定ごとに3種類)。
- パスワード変更に成功したら入力欄を空にする(GAS版は残っていた)。
- 設定の版数は `package.json` の version。
- 日報ダイアログ(`features/report`):
  - お客様の住所・世帯構成員は開いたあとに `GET /api/customers/:id` で読む(GAS版は一覧の中身をそのまま渡していた)。
    読み込むまでは見出しの住所が空で、「対象のお子様」は読めた時点で1人目を選ぶ。
  - 保存・AI生成の失敗は、サーバーが理由を返したらその理由を出す(GAS版は通信失敗の文言だけ)。「訪問終わりました」の
    失敗はGAS版と同じく「お知らせを送れませんでした…」。
  - 事故報告の保存は訪問日を送らない(APIの契約に訪問日が無いため。記録日時はサーバーの保存時刻)。
  - 開き直す前に届いたAI生成・読み取りの結果は捨てる(GAS版は開き直したあとの別のお客様の欄に入ってしまうことがあった)。
  - 開発サーバーのときだけ `window.__katahimoReport`(`openReport` / `openStandaloneReceipt`)を置く(見比べハーネス用)。
