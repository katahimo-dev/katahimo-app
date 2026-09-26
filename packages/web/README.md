# @katahimo/web(スタッフ用Webアプリ)

GAS版 `gas-childcare-visit-app` の画面(`legacy/gas-childcare-visit-app/gas-childcare-visit-app/index.html`)を
出発点に React + TypeScript で作り直したもの。**業務ロジック・計算結果は GAS版が正**(gasParity テストで一致を
確かめる)。画面は GAS版のマークアップ・クラス名・文言をそのまま引き継いだが、以後の見た目・操作の流れの変更は
このアプリの中だけで判断する(GAS版と見比べて揃える運用はしていない)。
画面ごとの振る舞い・業務ルール・権限は [`doc/02_機能仕様.md`](../../doc/02_機能仕様.md)、API は [`doc/04_API仕様.md`](../../doc/04_API仕様.md)。

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
pnpm vitest run --project web              # 画面のテストだけ(jsdom)
```

### テスト

`vitest.config.ts`(このフォルダ)が画面のテストのまとまり(`web`)で、ルートの `vitest.config.ts`(`test.projects`)から読まれる
(`pnpm test` でサーバー側のテストと一緒に動く)。`src/**/*.test.{ts,tsx}` を jsdom の上で動かし、部品・フックは
`@testing-library/react`(`render` / `renderHook`)で確かめる。`src/test/providers.tsx` に QueryClient・確認ダイアログ・
ログイン中のスタッフで包む `createWrapper()` と、返事の順番を決められる `deferred()` がある。APIは `vi.mock('…/api/…')`
で差しかえる(例: `features/report/hooks/useReportController.test.tsx` の「保存を待つ間に開き直した」場合)。

### 法人ID(テナント)の決め方

GAS版は1法人専用のためログイン画面に法人を選ぶ欄が無い。見た目を揃えるため、次の順で法人IDを決め、
**どれでも決まらないときだけ**ログイン画面に「法人ID」欄を出す(`src/lib/tenant.ts`)。

1. ビルド時の既定値 `VITE_DEFAULT_TENANT_SLUG`(1法人向けの本番ビルドではこれを設定する)
2. URL — `?t=<法人ID>`、または `VITE_TENANT_BASE_DOMAIN` を設定した場合のサブドメイン(`<法人ID>.<ベースドメイン>`)
3. このブラウザで最後にログインできた法人ID(localStorage)

設定例は `.env.example`。

## 使っているもの

- React 19 / TypeScript / Vite 7 / TanStack Query 5 / vite-plugin-pwa 1(Workbox)
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
  app/                     画面の骨格(全機能で共有)
    App.tsx                Provider の組み立て(エラーの受け止め / Query / 文字の大きさ / 確認ダイアログ / ログイン / トースト / 新しい版のお知らせ)
    AppShell.tsx           ヘッダー・3つのタブ(管理者・コーディネーターは「🛠 管理」を加えた4つ)・下タブ・設定ダイアログ
    Header.tsx, BottomNav.tsx, homeTabs.tsx(useHomeTabs)
    TextSizeProvider.tsx   useTextSize()
    adminTargetStaff/      管理者用「表示するスタッフ」(予定・出勤簿で共有)
    dataVersion/           顧客データの版数の監視(60秒ごと。画面が隠れている間は止める)
    pwa/                   新しい版(Service Worker)のお知らせ
    uiConfig/useUiConfig.ts  GET /api/ui-config(日報画面の文言・評価の定義)
  api/                     APIの呼び出し(1ファイル=1つのAPIのまとまり)
    client.ts              共通の fetch(zodで応答を検証、エラーの種類分け)
    queryKeys.ts           機能をまたいで無効化するクエリキー
    auth.ts, settings.ts, staff.ts, system.ts, push.ts
    admin.ts               管理画面(スタッフ管理・AIプロンプト・操作ログ・日報AIの調整)
  features/                機能ごとのフォルダ
    auth/                  ログイン・パスワード再設定・パスワード変更・セッション
    settings/              設定ダイアログ
    notifications/         設定の「通知」(Web Push の購読・テスト通知・受け取れない端末の判定)
    schedule/              「📅 今日の予定」タブ
    customers/             「👪 お客様」タブ・お客様の情報/これまでの記録
    report/                日報・事故報告・領収書ダイアログ
    attendance/            「🕒 出勤簿」タブとその中のダイアログ(今月のまとめ・まとめて取り込む・カレンダーと違うところ・領収書の一覧/画像)
    admin/                 「🛠 管理」タブ(管理者・コーディネーター): staff/(一覧・登録/編集ダイアログ)・reports/(報告一覧・報告の中身。コーディネーターはこれだけ)・prompts/(AIプロンプト)・reportAi/(日報AIの調整。管理者だけ)・logs/(操作ログ)
  lib/                     画面に依存しない小さな処理(storage / date / recentCustomers / textSize / tenant / messages / idle / saveFile・useFileDownload(ファイルの保存))
  ui/                      共通の部品(トースト・確認ダイアログ・ダイアログの外側 Modal・読み込み中・0件表示・ErrorBoundary・EducationLevelPicker(教育思考★の選択))
  test/                    テストの共通部品(providers.tsx・setup.ts)
```

## 機能どうしのつなぎ目

- 各タブの入口は `AppShell` が import する(`ScheduleTab`・`CustomersTab`・`AttendanceTab`、日報は `ReportModalProvider` / `useReportModal`)。
  名前を変えるときは `AppShell` も直す。
- **予定→日報**: 予定・お客様タブから日報を開くときは `useReportModal().openReport({ customerId, customerName })`、
  お客様に関係ない領収書は `openStandaloneReceipt()`。
- **予定→お客様タブへの移動**(GAS版 `jumpToCustomerFromSchedule`)は `useHomeTabs().switchTab('visitors')` を使い、
  検索欄への受け渡しは `features/customers` の中で用意する。
- 「🛠 管理」タブは `homeTabsFor(user.role)` が管理者・コーディネーター(`canActForOthers`)にだけ出し、`AppShell` もそのときだけ置く(`React.lazy` で別のJS)。
  中の「スタッフ」「報告一覧」「AIプロンプト」「日報AIの調整」「操作ログ」は切り替えると作り直す(コーディネーターには「報告一覧」だけを出し、タブの列は出さない)(AIプロンプトに保存していない変更があれば確かめる)。
  クエリキーは `features/admin/adminQueryKeys.ts`。スタッフを書き換えたら「表示するスタッフ」(`queryKeys.activeStaff`)と操作ログ、
  AIプロンプトを保存したら `queryKeys.uiConfig` も読み直す。日報AIの調整で行を保存・取り込んだら `adminQueryKeys.reportAi` と操作ログ、
  `queryKeys.uiConfig`(PSI の定義は日報の画面の評価の説明にも出る)を読み直す。
- **家庭の教育思考★**: お客様の詳細(`CustomerDetailModal`)と日報のダイアログ(`DailyAiSection`)は `features/customers/useCustomerReportProfile.ts`
  (キー `customerQueryKeys.reportProfile(customerId)`。`queryKeys.customers.all` で始まる)を共有し、どちらで変えてももう一方に出る。
- 出勤簿タブはGAS版と同じく**初めて開いたときに作られる**(`AttendanceTab` の初回描画 = GAS版 `initPastScheduleTab`)。
  タブを切り替えても作り直さない(隠すだけ)ので、入力途中の値は残る。
- 共有部分(`app/`・`api/client.ts`・`api/queryKeys.ts`・`lib/`・`ui/`)は全機能が使う。既存の関数の形を変えるときは使っている所を全て直す。
- **通知→予定タブ**: 翌日の予定のお知らせは `/?schedule=YYYY-MM-DD` を開く。予定タブ(`useScheduleView`)は最初の描画で URL の日付を
  選び(明日なら「🌙 明日」)、`AppShell` の `useScheduleLinkNavigation` が URL から取り除く。開いている画面で通知を押したときは
  Service Worker(`public/push-sw.js`)のメッセージを受けて表示するスタッフを本人に戻し、予定タブに切り替え、`openScheduleLink` で日付を知らせる
  (`features/schedule/scheduleLink.ts`)。
- **Service Worker**: vite-plugin-pwa の generateSW が作る `sw.js`(事前キャッシュ・新しい版のお知らせ)が、`workbox.importScripts` で
  `public/push-sw.js`(通知の表示と通知を押したときの処理)を読む。テストは `src/test/pushServiceWorker.test.ts`(`node:vm` で動かす)。

## 書き方の決まり

- **見た目**: GAS版のクラス名をそのまま使う(`className` に同じ文字列)。GAS版がJSで付け外ししていたクラス
  (例: 選択中のタブの `border-blue-600 text-blue-600`)は、状態に応じて同じクラスを付ける。
  `innerHTML` で文字列を組み立てるGAS版の書き方はしない(JSXで書く)。
- **文言**: GAS版と一字一句同じにする(全角・半角、「…」と「...」の違いも含む)。GAS版で共通の文言は `src/lib/messages.ts`。
- **ダイアログ**: すべて `ui/modal` の `Modal`(外側の暗い背景)と `ModalHeader` / `ModalFooter` を使う。外側のクラスはGAS版の
  外側divのクラスから `hidden` / `opacity-0` を除いたものを渡す。z-index はGAS版と同じ値にする(下表)。
  - 開き方: GAS版は `hidden` と `opacity-0` を付け外しして開閉する(開くとき10ms後に不透明、閉じるとき300ms後に隠す)。
    これが既定の `transition="fade"`。出勤簿のダイアログはGAS版もフェードしないので `transition="none"`。
    閉じても中身を残すダイアログ(GAS版のDOMが残るもの)は `keepMounted`。中身の scale / translate を開閉で変えるときは
    `children` に関数を渡すと `{ shown }` を受け取れる。
  - キーボード・読み上げ(`useDialogA11y`。見た目は変えない): 開くとダイアログ自身(確認ダイアログ `role="alertdialog"` は
    中の最初のボタン)にフォーカスし、Tab はダイアログの中だけを回り、後ろの画面は `inert`、閉じると開く前の場所に
    フォーカスを戻す。`onClose` を渡すと Escape で閉じる(GAS版の × と同じ動きで閉じてよいものだけ渡す)。
    お知らせ(`data-dialog-keep-interactive`)は inert にしない。
  - `FadeModal` は `Modal` の古い名前(設定ダイアログが使っている)。新しく書くときは `Modal`。
- **お知らせ**: `showToast(message, isError)` / `hideToast()`(`ui/toast`)。GAS版と同じく、ふつうは4秒で消え、
  失敗(`isError = true`)は「閉じる」を押すまで消えない。
- **確認**: GAS版が標準の `confirm()` / `alert()` を使っている場所は `confirmNative` / `alertNative`、
  独自の確認ダイアログ(#confirmationModal)を使っている場所は `useConfirmModal()`(`ui/confirm`)。
- **読み込み中・0件・失敗**: `ui/StatusViews.tsx` の `Loading`(「読み込んでいます…」)・`EmptyState`・`ErrorState`。
- **フォーム**: ログイン・パスワード再設定・パスワード変更は `<form noValidate onSubmit>` と `type="submit"` のボタンにする
  (キーボードの Enter / 「開く」で送れる。検証はGAS版と同じ文言を自前で出す)。メール欄は `type="email" inputMode="email"`。
- **読み上げ**: 文字の欄がない(placeholder だけの)入力欄には `aria-label` を付ける。★の評価は `role="radiogroup"` /
  `role="radio"`(矢印キーで動かせる)、日報・事故の切り替えは `role="tablist"` / `role="tab"`。
- **エラーの受け止め**: 描画中の例外は `ui/ErrorBoundary.tsx` で受け止める。アプリ全体は「画面を表示できませんでした」+
  「再読み込み」、各タブは「この画面を表示できませんでした」+「もう一度読み込む」(失敗していたクエリも読み直す)。
- **API**: `src/api/<機能>.ts` に `api.get(path, 応答のzodスキーマ, query)` / `api.post(path, スキーマ, body)` で
  呼び出しをまとめ、画面では TanStack Query(`useQuery` / `useMutation`)から使う。応答は必ず契約のスキーマで検証する
  (契約に無い応答を返すAPIは、まず `packages/shared/src/contracts` に契約を足す)。
  - エラーの文言は `userMessageOf(error)`: サーバーが理由を返したらその理由、通信失敗などは
    「うまくいきませんでした。電波を確認して、もう一度押してください」(GAS版の withFailureHandler と同じ)。
  - APIの失敗を赤いお知らせで出すときは `showErrorToast(error)`(`ui/toast`)。401(セッション切れ)は自動でログイン画面に
    戻り「しばらく使っていなかったので、もう一度ログインしてください」を出すため、お知らせは出さない。
  - 回数の上限(429 `rate_limited`)は、サーバーの理由に Retry-After から「（あと約15分）」を添える(`userMessageOf`)。
  - ファイルの保存(出勤簿の Excel・操作ログ/報告一覧/領収書の一覧の CSV)は `api.download(path, query, 種類, 代わりの名前)` で受け、
    `lib/saveFile.ts` の `saveBlobAsFile` で保存する。ボタンは `lib/useFileDownload.ts` の `useFileDownload()`(保存している間は2回目を
    送らない・成功と失敗をお知らせで出す)を使う。断られたときは JSON の理由を読んで他の API と同じエラーにする(`<a href download>` だと
    理由の JSON がファイルになってしまうため、保存のリンクは作らない)。
  - 読み込みの失敗は1回だけ読み直す。ただしサーバーが理由を付けて断った失敗(4xx)は読み直さない(`app/queryClient.ts`)。
  - 起動時に `/api/auth/me` が通信の失敗だったときは、ログイン画面ではなく「うまくいきませんでした…」+「もう一度読み込む」を
    出す(ログインしていないと決めるのは 401 のときだけ)。
- **ログイン中の人**: `useSession().user`(`staffId` / `name` / `role`)。管理者向けの表示の出し分けは `isAdminRole(user.role)`、
  他のスタッフを選べるか(表示するスタッフ)は `canActForOthers(user.role)`(`@katahimo/shared`)。
  その人の localStorage の値のキーには `useSession().storageScope` を使う(下の「localStorage のキー」)。
- **管理者・コーディネーターの「表示するスタッフ」**: タブの一番上に `<AdminTargetStaffSelect id="…" />` を置き、APIには
  `useAdminTargetStaff().requestStaffId` を `staffId` として渡し、クエリキーにも入れる(選び直すと自動で読み直される)。
  管理者・コーディネーター以外は `undefined`(= 本人。サーバーも一般スタッフの staffId は無視する)。
- **顧客データのクエリ**は `queryKeys.customers.all` で始まるキーにする(新しい顧客CSVが取り込まれたとき、版数の監視が
  まとめて読み直すため)。領収書の一覧のクエリは `queryKeys.receipts.all` で始まるキーにする(日報の画面の `useReceipts` が
  領収書を送れたら読み直す)。
- **localStorage**: キーは `src/lib/storage.ts` の `STORAGE_KEYS` に足してから使う。GAS版と同じ意味の値はGAS版と同じキー名。
  使う人の値(書きかけ・前回値など)は `USER_SCOPED_KEYS` に足し、`userStorageKey(key, storageScope)` のキーで読み書きする。
- **日付**: 業務日は端末の時刻帯に関係なく JST の `'YYYY-MM-DD'`(契約の `businessDateSchema`)。「今日」「いまの時刻」は
  `src/lib/date.ts`(`todayJst` / `jstHHmm` / `jstParts`。Intl の timeZone: Asia/Tokyo)、日付どうしの計算は
  `addDaysYmd` / `weekdayOfYmd`(UTCの暦で計算)を使い、`new Date().getDate()` のような端末の時刻帯の値は使わない。
- **分けて読むJS**: 出勤簿タブと、そのあまり使わないダイアログ(今月のまとめ・まとめて取り込む・カレンダーと違うところ・領収書の一覧)は
  `React.lazy` で別のJSにし、手が空いたとき(`lib/idle.ts`)に先に読んでおく(開いたときに待たないように)。
- コメント・コミットメッセージは日本語。

### localStorage のキー

| キー | 中身 | GAS版と同じ |
| --- | --- | --- |
| `app_text_size` | 文字の大きさ `normal` / `large` / `xlarge`(古い `small` / `medium` は `normal` に置きかえる) | ○ |
| `katahimo_last_tenant_slug` | 最後にログインできた法人ID | (新規) |
| `katahimo_session_hint` | ログインしていた印(期限切れの案内を出し分ける。Cookieはスクリプトから読めないため) | (GAS版はトークンの有無で判断) |
| `katahimo_schedule_route_v1_<スタッフID>_<日付>` | 予定タブのルートつき予定の2時間キャッシュ(`{res, ts}`)。読むときに契約で確かめ、書くときに期限切れを消す | (GAS版 `GAS_SCHEDULE_ROUTE_V2_<スタッフ名>_<日付>` と同じ役割。スタッフをIDで区別するため別名) |
| `pastSchedWeek_<スタッフID>_<週の日曜>` | 出勤簿タブの週間予定の2時間キャッシュ(`{events, ts}`)。保存・取り込みの後に消す | ○(GAS版はスタッフ名。ここではID) |
| `attendanceMonthly_<スタッフID>_<YYYY-MM>` | 今月のまとめの2時間キャッシュ(`{res, ts}`)。保存・取り込みの後に消す | ○(同上) |
| `GAS_RECEIPT_KEYS_V1_<スタッフ名>` | この端末から送った領収書の重複チェック用 | ○ |
| `cal_week_view_mode` | 週の表示(一覧/表)。端末の好みなので人ごとに分けない | ○ |
| `recent_customers@<法人ID>/<スタッフID>` / `pending_report_draft@…` / `last_start_hour@…` / `last_start_minute@…` / `last_acc_time@…` | 最近開いたお客様・書きかけの日報・日報の開始時刻・事故の発生時刻の前回値(ログインしている人ごと) | △(中身の形はGAS版と同じ。GAS版は1人1端末が前提で人ごとに分けていなかった) |
| `katahimo_push_endpoint@<法人ID>/<スタッフID>` | この端末で本人が通知をオンにしたときの購読の endpoint(同じ端末で別の人がオンにしていたら本人にはオフに見せる) | (新規) |

GAS版の `GAS_AUTH_TOKEN` / `GAS_STAFF_SESSION_V3` / `GAS_STAFF_ADMIN` は使わない(ログインは httpOnly Cookie、管理者かどうかは `/api/auth/me`)。

ログアウト・セッション切れのとき(`features/auth`):

- ログアウト: その人の値(上の表の `@<法人ID>/<スタッフID>` のもの)と、表示用の2時間キャッシュ(ルート・週間予定・今月のまとめ)を
  消し、TanStack Query のキャッシュも捨てる。その前に、この端末で本人がオンにしていた通知をやめる(`useSession().logout` の中。どの画面からのログアウトでも)。
  ログインしたときは、本人がオンにしたのではない端末の購読(前にこの端末を使った人のもの)を端末でやめる(`releaseForeignPushSubscription`)。
- セッション切れ(401): 表示用の2時間キャッシュと TanStack Query のキャッシュを捨てる。書きかけの日報などその人の値は、
  その人にしか見えないので残す(もう一度ログインすると続きから書ける。GAS版と同じ)。
- お客様タブの探す欄の文字はログイン後の画面(AppShell)の中だけに持つので、ログイン画面に戻ると空になる。
- 人ごとに分ける前の(キー名だけの)値は、誰のものか分からないのでログインしたときに消す。
- 領収書の重複チェック用のキー(`GAS_RECEIPT_KEYS_V1_<スタッフ名>`)はスタッフごとに分かれており、同じ領収書を二重に
  送らないためのものなので消さない。

### z-index(GAS版と同じ)

| 値 | ダイアログ |
| --- | --- |
| `z-10` / `z-20` | ヘッダー / 下タブ |
| `z-50` | ログイン、日報・事故報告 |
| `z-[60]` | パスワード再設定、ヒント、お客様の情報、これまでの記録、スタッフの登録・編集(管理。上に確認ダイアログを重ねる)、報告の中身(管理の報告一覧) |
| `z-[70]` | 確認ダイアログ(useConfirmModal) |
| `z-[100]` | 設定 |
| `z-[110]` | パスワード変更、今月のまとめ、まとめて取り込む |
| `z-[115]` | カレンダーとの見比べ、領収書の一覧 |
| `z-[120]` | 予定の修正、領収書の画像(一覧の上に重ねる) |
| `z-[130]` | お知らせ(トースト) |

## GAS版と意図的に変えているところ

- ログイン状態は httpOnly Cookie(GAS版はトークンを localStorage に置いていた)。法人IDの欄は上記の条件のときだけ出る。
- 使う人の localStorage の値は、ログインしている人ごとのキーに分けて持ち、ログアウトしたら消す(上の「localStorage のキー」)。
- 起動時にログインを確かめられなかった(通信の失敗)ときは、ログイン画面ではなく「もう一度読み込む」を出す。
- ダイアログはキーボード・読み上げで使えるようにした(フォーカスの移動・閉じ込め・Escape・後ろの画面の inert。見た目は同じ)。
  ログインなどは Enter でも送れる。
- 業務日・時刻は端末の時刻帯に関係なく日本時間で数える(GAS版は出勤簿・日報で端末の時計を使っていた)。
- 顧客データの版数の監視は、画面が隠れている間は止める(GAS版は隠れていても1分ごとに確かめていた)。
- PWA: 新しい版が届いても勝手に読み込み直さず、お知らせの「更新する」で切り替える(書きかけの入力を消さないため)。
  開いたままの端末でも気づけるよう1時間ごとに確かめる。GAS版には無い。
- 画面の描画が失敗したときは、真っ白にせず「再読み込み」(全体)・「もう一度読み込む」(タブ)を出す。
- 領収書の写真を読み込めなかったときは「写真を読み込めませんでした。別の写真を選んでください」を出す(GAS版は何も出さずに
  足さなかった)。送っている間は写真を消せない。
- 失敗のお知らせは読み上げで すぐに伝える(`role="alert"`)。同じ文言を続けて出しても、そのたびに読み上げる。
- GAS版は未ログインでも顧客データの版数を確かめ、失敗のお知らせが出ることがあった。新アプリはログイン後だけ確かめる。
  また顧客CSVの取り込みはサーバーが定期実行するため、画面を開いたときの取り込み(checkAndImportLatestCsv)はしない。
- 今月のまとめに「⬇ Excelで保存」「⬇ <年度>年度分」、管理者には「⬇ 全員分をExcelで保存」を置く(GAS版は個別出勤簿のスプレッドシートを
  直接開いていた。`doc/02_機能仕様.md` 8.6)。
- 出勤簿タブに「🧾 領収書」(今月のまとめの「🧾 領収書の一覧・画像を見る」からも開く)を置き、月ごとの領収書の一覧・月の合計・画像を
  アプリの中で見られるようにする(GAS版は管理者が「領収書一覧」シートと Drive のフォルダで見ていた)。一般スタッフも本人の分を見られ、
  管理者・コーディネーターは他のスタッフ・全員分と「⬇ CSVで保存」。画像は `<img src="/api/receipts/<ID>/image">` で API から読む
  (署名付きURLは使わない。`doc/02_機能仕様.md` 7.1)。
- 管理者・コーディネーターには下タブに「🛠 管理」を出す(スタッフ台帳・AIプロンプトのシートの編集、「日報」「事故報告」シートの閲覧と
  Drive の CSV ログの確認の置き換え。コーディネーターは報告一覧だけ。`doc/02_機能仕様.md` 10章)。
- パスワード再設定の画面に「番号が届いている方はこちら」を置く(管理者が送った「パスワード設定の案内」の番号を、送り直さずに
  入力する)。
- 設定の詳細設定は1回のAPI(GET /api/settings/admin)で読むため、読み込み中に保存したときの案内は
  「Gemini APIキーの読み込みが完了してから保存してください」の1種類(GAS版は設定ごとに3種類)。
- パスワード変更に成功したら入力欄を空にする(GAS版は残っていた)。
- 設定の版数は `package.json` の version。
- 日報ダイアログ(`features/report`):
  - お客様の住所・世帯構成員は開いたあとに `GET /api/customers/:id` で読む(GAS版は一覧の中身をそのまま渡していた)。
    読み込むまでは見出しの住所が空で、「対象のお子様」は読めた時点で1人目を選ぶ。
  - 日報モードでは AI に書いてもらう前に、対象のお子様(1人だけなら最初から選ぶ)・家庭の教育思考★・PSI を選べる
    (`DailyAiSection`。評価の欄はメモより上に置き、PSI 2 以下を選ぶと管理者に知らせることを出す)。AI の結果に使った教育の言葉を出し、
    PSI 1 のときは管理者へ連絡する知らせを出す。保存のときに生成の記録の ID(`aiGenerationId`)とお子様を送る。
  - 保存・AI生成の失敗は、サーバーが理由を返したらその理由を出す(GAS版は通信失敗の文言だけ)。「訪問終わりました」の
    失敗はGAS版と同じく「お知らせを送れませんでした…」。
  - 事故報告の保存は訪問日を送らない(APIの契約に訪問日が無い。GAS版の画面は送るがサーバーは使っておらず、記録日時はどちらもサーバーの保存時刻)。
  - 開き直す前に届いたAI生成・読み取りの結果は捨てる(GAS版は開き直したあとの別のお客様の欄に入ってしまうことがあった)。
    保存も同じで、開き直す前に送った保存の結果が届いても、今の入力を「✅ 保存しました」にせず、上書き用の報告IDも持たない
    (お知らせ「保存しました」は出す)。サーバーも、別のお客様の報告IDでの上書きは 409 で断る。
  - 「🎤 話して入力」は、ダイアログを閉じたとき・開き直したときに止める(聞き取り途中の文は捨てる)。
