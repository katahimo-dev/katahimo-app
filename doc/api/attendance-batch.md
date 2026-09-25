# 出勤簿・カレンダー反映・バッチ・顧客CSV取込 API

GAS版(`legacy/gas-childcare-visit-app/gas-childcare-visit-app/`)の `PastSchedule.js` / `AttendanceCalc.js` /
`CsvImport.js` / `Triggers.js` と、`RouteSearch.js` の出勤簿関連部分を移植したAPIとバッチの仕様。
リクエスト/レスポンスのzodスキーマは `packages/shared/src/contracts/` の `attendance.ts` /
`calendarSync.ts` / `customerImport.ts`。

## 共通事項

- 認証はセッションCookie(`/api/auth/login`)。未ログインは `401 {code:'unauthenticated'}`。
- **対象スタッフ**: `staffId` を指定できるのは管理者だけ。一般スタッフが指定しても無視され、常に本人になる
  (GAS版 `resolvePastScheduleTargetStaffName_`、API側 `resolveAttendanceTargetStaffId`)。存在しない/他テナントの
  スタッフは `404 {code:'not_found'}`。
- エラーは `{code, message, fields?}`。`code` は `validation_failed`(400)/ `locked`(400、月ロック)/
  `forbidden`(403)/ `not_found`(404)/ `upstream_unavailable`(502、カレンダー予定を取得できない)。
- 日付は JST の暦日 `YYYY-MM-DD`、年月は `YYYY-MM`。
- `rowData` のキーは出勤簿の列記号(`C` `D` `E` … `AO`、doc/09 4.1節)。列の意味は
  `packages/core/src/domain/attendance/sheetLayout.ts` が唯一の定義。値は文字列(数値で送っても文字列として保存)。
- 操作ログ(`app_logs`): 失敗・拒否(WARN/ERROR)は常に、書き込み(修正・反映)は常に INFO、閲覧は
  **管理者が他スタッフのデータを見た場合だけ** INFO(`actor_staff_id`=操作した管理者、`target_staff_id`=対象)。

## 出勤簿(過去の予定タブ)

### `GET /api/attendance/day?date=YYYY-MM-DD[&staffId=]`

GAS版 `getPastScheduleForDate`。レスポンス `{ attendance }`:

| 項目 | 内容 |
| --- | --- |
| `businessDate` `staffId` `staffName` | 対象 |
| `found` | 記録があるか。`false` なら `rowData` は空(GAS版「記録が出勤簿に見つかりません」に相当。画面は空の行として編集できる) |
| `rowData` / `derived` | 入力列 / 数式列相当の派生値(`workedMinutes`=所定内+所定外 を含む) |
| `changedFields` | 自動転記後に手で変更された列(スプレッドシートで背景 `#fce4e4` になるセル) |
| `editable` `editableFrom` `editableTo` | 月ロック。今日(JST)が属する月の1日〜末日だけ編集できる(管理者も同じ) |
| `optionsI` `optionsR` | 天候の選択肢(`['晴れ','曇り','雨','雪']`。GAS版はシートの入力規則から読んでいた値を固定で持つ) |

### `PUT /api/attendance/day`

GAS版 `updatePastSchedule`。ボディ `{ date, staffId?, rowData }`。

- 当月以外の日付は `400 {code:'locked', message:'修正期限切れです。当月(09/01)より前の記録は変更できません。'}`
  (来月以降は `'修正できません。来月以降(09/30より後)の記録はまだ修正できません。'`)。何も保存しない。
- **送られた列だけ**を現在値と比較し、値が変わった列だけを書く(送られていない列はそのまま。空文字で消せる)。
- 変わった列は `changed_fields` に追加し、`last_changed_by_staff_id` を操作者にし、`attendance_day_changes` に
  変更前の行(暗号化)・変更した列・操作者を追記する(同一トランザクション)。そのうえで `attendance_day` の
  ミラーを outbox に積む。
- レスポンス `{ attendance, changedCount, changedColumns, message }`。`message` は `'修正しました。'` か
  `'変更はありませんでした。'`(変更なしの場合は保存・履歴・ミラーとも行わない)。

### `GET /api/attendance/month?month=YYYY-MM[&staffId=]`

GAS版 `getAttendanceMonth` + `getReceiptsForMonth_`。レスポンス `{ month }`:
`yearMonth` `staffId` `staffName`、`days`(**月の全日**。記録の無い日は空の `rowData`)、`totals`(月合計。
`workedMinutes` を含む)、`receipts: { byDay: {'YYYY-MM-DD': 金額}, total }`(領収書日時のJST暦日で集計。
金額は復号して数値化し、読めない金額は0円、復号できない領収書は集計から外してWARNログのみ)。

### `GET /api/attendance/week?start=&end=[&staffId=]`

GAS版 `getWeeklyScheduleForStaff`。出勤簿の記録を週間表示用のイベントにした閲覧専用ビュー(最大31日、
日付順・枠順)。レスポンス `{ events: [{date, slotKey, title, eventType, start, end}] }`。

## カレンダー → 出勤簿

予定は `SchedulePort.getScheduleWithRoute(staffName, date, false, { tenantId, fresh: true })` から毎回最新を取る
(出勤簿は正式な記録のため共有キャッシュを読み書きせず、読めないカレンダーがあれば部分的な結果ではなく
`502 upstream_unavailable` にする。GAS版 `refreshAttendanceForStaffOnDate` と同じ規則)。予定の実装
(`SCHEDULE_PROVIDER` = google / gas_bridge / noop)は `doc/api/schedule-route.md` を参照。
変換と非破壊マージは `packages/core/src/domain/attendance/calendarSync.ts`(GAS版
`buildTimesheetRowDataFromAppointments_` / `mergeOverlappingOfficeWork` / `buildCalendarSyncPlan_` を移植し、
`gasParity.test.ts` でGAS版のコードそのものと出力一致を確認している)。**月ロックは掛からない**(GAS版と同じ)。

- カレンダーにある枠(訪問#1〜#3・事務作業#1〜#2)はカレンダーの内容で上書き。
- 出勤簿にだけある枠は、カレンダー由来の枠と時間が重なる場合だけクリアし、重ならなければ残す。
- 退勤距離は最後に埋まった訪問の枠と一緒に反映する。天候・買物代行・備考には触れない。
- `changed_fields`(手で直した列の強調表示)は増やしも消しもしない。

### `GET /api/attendance/day/calendar-sync/preview?date=[&staffId=]`

GAS版 `previewCalendarSyncForStaffOnDate`。書き込みなし。レスポンス
`{ staffId, staffName, date, appointmentCount, hasChanges, changes: [{column, label, oldValue, newValue}] }`。

### `POST /api/attendance/day/calendar-sync`

GAS版 `applyCalendarSyncForStaffOnDate` / `syncPastScheduleFromCalendar`。ボディ `{ date, staffId? }`。
クライアントが見たプレビューは信用せず、同じ計算をやり直してから書く。

- **冪等**: 同じカレンダー内容なら2回目以降は `changedCount: 0` で、出勤簿の保存・履歴・`attendance_day` ミラーは
  行わない。「勤怠集計」(`attendance_aggregate`)のミラーは毎回積む(GAS版も毎回書き直していた)。
- 変更があれば出勤簿を保存し、`attendance_day_changes` に履歴(操作者つき)を追記する。
- レスポンス `{ staffId, staffName, date, appointmentCount, changedCount, changes }`。
- **管理者の期間一括反映**(GAS版の「一括反映」モーダル)は、クライアントがスタッフ×日ごとにこのAPIを順に呼び、
  成功/失敗数を数える(GAS版 `runCalendarSyncQueue` と同じ)。失敗分だけの再実行もそのまま行える。

### `POST /api/attendance/day/aggregate/refresh`(管理者のみ)

GAS版 `refreshAttendanceForStaffOnDate`。ボディ `{ date, staffId }`。「勤怠集計」シートの該当スタッフ・該当日の
行の書き直しを outbox に積む(個別出勤簿は書き換えない)。一般スタッフは `403`(WARNログ)。レスポンス
`{ staffId, staffName, date, appointmentCount, rowData }`(`rowData` はカレンダーから組み立てた参考値)。

## 顧客CSV・データ版数

### `POST /api/admin/customers/import`(管理者のみ)

GAS版 `forceImportCsv`。ボディ `{ force?: boolean }`(既定 `true`=取込済みの版でも取り込み直す)。
取込処理は下記 `csv-import` ジョブと同じ(`packages/ingestion/src/customerCsvImport/`)。操作した管理者のIDと名前を
`app_logs` に残す(管理者以外は `403`、`customer_csv.import.access_denied` をWARNログ)。レスポンス `{ status, message, fileName, version, stats, dataVersion }`、`status` は
`imported` / `up_to_date` / `no_files` / `not_configured`(200)、`review_required`(409)、`failed`(502)。

GAS版は顧客シートを丸ごと書き換えていたが、こちらは RESERVA 顧客IDでの差分適用で、CSVから消えた顧客が既存の
20%を超える場合は適用しない(`review_required`、版も進めない)。内容を確認して取り込む場合は
`pnpm --filter @katahimo/api import:reserva -- <tenantSlug> <CSVパス> --force`。

> GAS版は画面を開くたびにクライアントから `checkAndImportLatestCsv` を呼んでいたが、新版では取込は定期ジョブと
> 管理者操作だけにした(多数の端末から重い取込処理が走らないように)。画面は下の版数ポーリングだけを行う。

### `GET /api/data-version`

GAS版 `checkDataVersion`。レスポンス `{ dataVersion: '12' }`(顧客CSVを取り込むたびに+1)。クライアントは60秒ごとに
ポーリングし、前回値と違えば顧客一覧を読み直す。

## バッチ(packages/worker)

| 実行単位 | コマンド | 内容 | Cloud Scheduler(JST) |
| --- | --- | --- | --- |
| 常駐 | `pnpm --filter @katahimo/worker start` | outbox ミラーのポーリング(Cloud Run サービス、最小インスタンス1) | — |
| ジョブ | `pnpm job:nightly-calendar-sync` | GAS版 `autoSyncTodayScheduleForAllStaff`: 利用中の全テナントの在籍スタッフの当日分をカレンダーから出勤簿へ反映。スタッフごとに失敗を記録して続行し、テナントごとのまとめを INFO ログ。冪等 | `0 22 * * *`(`CRON_TZ=Asia/Tokyo`) |
| ジョブ | `pnpm job:csv-import` | GAS版 `checkAndImportLatestCsv`: 各テナントの取込元の最新CSVが未取込なら取り込む | `0 3 * * *`(`CRON_TZ=Asia/Tokyo`) |
| ジョブ | `pnpm --filter @katahimo/worker job:sync-busy-blocks` | スタッフのGoogleカレンダーの free/busy を `staff_busy_blocks` に同期(将来のマッチング用、doc/10。GAS版に相当機能なし)。期間は今日から `BUSY_BLOCK_SYNC_DAYS` 日 | 既定では登録しない(使う場合は例: `0 * * * *`) |
| 確認用 | `pnpm --filter @katahimo/worker outbox:once` | outbox を1回だけ処理して終了 | — |

- ジョブは Cloud Run Jobs として同じ worker イメージの別コマンドで動かす(ビルド済みの
  `node dist/<job>.js`。`<job>` は `nightly-calendar-sync` / `csv-import` / `sync-busy-blocks` / `outbox-once`。
  構成は `Dockerfile` / `infra/gcp/run.tf`、手順は `doc/11_GCPデプロイ手順.md`)。
  失敗(反映に失敗したスタッフがいる・取込が `failed`/`review_required`)があると終了コード1になり、
  Cloud Run Jobs の再試行・アラートに乗る。ログは1行JSON(Cloud Logging の構造化ログ)。
- 取りこぼした日の流し直し: `pnpm job:nightly-calendar-sync -- 2026-09-24`。
- ローカル開発では `WORKER_IN_PROCESS_CRON=true` で常駐ワーカーの中でも 22:00 / 03:00 JST に同じジョブを動かせる。
- 夜間反映は顧客CSV取込(03:00)で最新化された住所を前提にしている(GAS版 `Triggers.js` と同じ順序)。

### outbox の再試行

失敗したジョブは `attempts`(取得のたびに+1)に応じて `next_attempt_at` を
`OUTBOX_RETRY_BASE_DELAY_MS × 2^(attempts-1)`(上限 `OUTBOX_RETRY_MAX_DELAY_MS`)だけ先送りして `pending` に戻し、
`last_error` を残す。`OUTBOX_MAX_ATTEMPTS` 回失敗したら `failed` にして自動再試行をやめ、`app_logs` に
ERROR(`mirror.job_failed`)を残す。`processing` のまま10分以上更新されないジョブ(ワーカーの異常終了)は
次のポーリングで取り直す。GAS Bridge 呼び出しは HTTP エラー・JSON以外の応答・タイムアウト(120秒)も失敗扱い。

## 環境変数

| 変数 | 使う側 | 内容 |
| --- | --- | --- |
| `SCHEDULE_PROVIDER` ほか `GOOGLE_MAPS_API_KEY` / `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_CALENDAR_IDS` / `GOOGLE_CALENDAR_IMPERSONATE` | API・ワーカー | 予定・ルート計算の実装(doc/api/schedule-route.md)。夜間反映のワーカーもAPIと同じ設定にする |
| `GAS_BRIDGE_URL` / `GAS_BRIDGE_SECRET` | API・ワーカー | GAS版 Web App(Bridge.js)。ミラー書き込み先(未設定ならミラー送信は何もしない)、`SCHEDULE_PROVIDER=gas_bridge` の予定取得元 |
| `BUSY_BLOCK_SYNC_DAYS` | ワーカー | `job:sync-busy-blocks` の同期期間(日、既定28) |
| `MIRROR_TO_GOOGLE_SHEETS` | API | `true`/`1` のときだけ outbox に積む(以前は `'false'` も真になっていた不具合を修正) |
| `CUSTOMER_CSV_DRIVE_FOLDERS` | API・ワーカー | `{"テナントslug":"DriveフォルダID"}`。サービスアカウント(ADC / `GOOGLE_APPLICATION_CREDENTIALS`)に閲覧共有する。`Kokyaku_YYYYMMDDHHmm_N.csv` のうちファイル名の日時が最新のものを取り込む |
| `CUSTOMER_CSV_LOCAL_DIR` | API・ワーカー | ローカル開発用。`<dir>/<テナントslug>/` を取込元にする(Drive設定が無い場合のみ) |
| `OUTBOX_POLL_INTERVAL_MS` / `OUTBOX_BATCH_SIZE` | ワーカー | 既定 5000 / 10 |
| `OUTBOX_MAX_ATTEMPTS` / `OUTBOX_RETRY_BASE_DELAY_MS` / `OUTBOX_RETRY_MAX_DELAY_MS` | ワーカー | 既定 8 / 30000 / 3600000 |
| `WORKER_IN_PROCESS_CRON` | ワーカー | `true` で常駐ワーカー内の定期実行を有効にする(ローカル用) |
| `WORKER_HEALTH_PORT` | ワーカー | 常駐ワーカーをヘルスチェック用に待ち受けさせるポート(Cloud Run サービス用。未設定なら待ち受けない) |

## GAS側(Bridge.js)に必要な変更

`legacy/` サブモジュールは読み取り専用のため、以下は GAS版リポジトリ(`katahimo-dev/gas-childcare-visit-app`)で行う。

1. **`writeAttendanceDay` の強調表示**(必須): ペイロードに `highlightColumns: string[]`(列記号)が加わった。
   現行の `bridgeWriteAttendanceDay_` は値を書くだけなので、書き込み後に次を追加する
   (GAS版 `updatePastSchedule` の `cell.setBackground('#fce4e4')` と同じ表示にするため)。未対応のままでも値の
   書き込みは従来どおり動く(強調表示だけが付かない)。

   ```js
   (payload.highlightColumns || []).forEach(function (colChar) {
     if (!(colChar in PAST_SCHEDULE_INPUT_COLUMNS)) return;
     target.sheet.getRange(target.rowNumber, pastScheduleColumnToNumber_(colChar)).setBackground('#fce4e4');
   });
   ```

   `values` には記録のある列だけが入る(記録の無い列はシートの値をそのまま残す)。
2. **`writeAttendanceAggregate`**: 変更不要(ペイロード `{ staffName, businessDate }`。行の中身はGAS側がカレンダーと
   Maps から計算し直し、該当スタッフ・該当日の既存行を消してから書くため再送しても重複しない)。
   予定の取得を新版の SchedulePort(Google Calendar + Maps の直接呼び出し)に切り替えた後も、勤怠集計シートの
   行はGAS側の計算のままになる点に注意(両者の計算結果を揃えたい場合は、将来 `rows` をペイロードで渡す action を
   追加する)。
3. **共有シークレットの受け取り方**(推奨、セキュリティレビュー 2026-09): 新版は Bridge.js への要求に
   シークレットを `X-Katahimo-Bridge-Secret` ヘッダーとURLクエリ `secret` の両方で付けている。Apps Script の Web App
   (`doGet(e)` / `doPost(e)`)はリクエストヘッダーを読めないため、現行の Bridge.js はクエリの `secret` で認証しており、
   クエリは外せない(URLはGoogle側のアクセスログ等に残りやすい)。Bridge.js を次のように変えたら、新版
   (`packages/integrations/src/gas-bridge/gasBridgeClient.ts`)の POST からクエリの `secret` を外す:
   - `doPost`: `verifyBridgeSecret_(params.secret)` を、本体の JSON(`JSON.parse(e.postData.contents).secret`)の
     値でも認証できるようにする(移行期間は両方を受け付ける)。書き込み処理は本体の `secret` を無視するようにする。
   - 読み取り系(`doGet` の `?api=1`、ジオコーディング・ルート計算・予定)も POST(本体に `secret`)で受け付ける
     action を足す(GET には本体が無いため、クエリ以外にシークレットを載せる場所が無い)。
4. GAS版の時限トリガー `autoSyncTodayScheduleForAllStaff` / `checkAndImportLatestCsv`(`Triggers.js`)は、新版の
   ジョブを本番で動かし始めたら `setupAllTriggers()` の定義で `enabled: false` にして止める(二重反映・二重取込を
   避けるため)。
