# 出勤簿・カレンダー反映・バッチ・顧客CSV取込 API

GAS版(`legacy/gas-childcare-visit-app/gas-childcare-visit-app/`)の `PastSchedule.js` / `AttendanceCalc.js` /
`CsvImport.js` / `Triggers.js` と、`RouteSearch.js` の出勤簿関連部分を移植したAPIとバッチの仕様。
リクエスト/レスポンスのzodスキーマは `packages/shared/src/contracts/` の `attendance.ts` /
`calendarSync.ts` / `customerImport.ts`。

## 共通事項

- 認証はセッションCookie(`/api/auth/login`)。未ログインは `401 {code:'unauthenticated'}`。
- **対象スタッフ**: `staffId` を指定できるのは管理者・コーディネーターだけ。一般スタッフが指定しても無視され、常に
  本人になる(GAS版 `resolvePastScheduleTargetStaffName_`、API側 `targetStaffIdOf`)。存在しない/他テナントの
  スタッフは `404 {code:'not_found'}`。
- エラーは `{code, message, fields?}`。`code` は `validation_failed`(400)/ `locked`(400、月ロック・締めた月)/
  `forbidden`(403)/ `not_found`(404)/ `conflict`(409、古い `rowVersion`)/
  `upstream_unavailable`(502、カレンダー予定を取得できない)。
- DB の正は実体(`attendance_days`・`visits`・`work_segments`・`travel_legs`)で、`rowData` はその投影(doc/09 第3章)。
- 日付は JST の暦日 `YYYY-MM-DD`、年月は `YYYY-MM`。
- `rowData` のキーは出勤簿の列記号(`C` `D` `E` … `AO`)。列の意味は
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
| `changedFields` | 自動転記後に手で変更された列(スプレッドシートで背景 `#fce4e4` になるセル。実体の `overridden_fields` から作る) |
| `rowVersion` | 楽観的排他の版(記録の無い日は0)。`PUT` に送り返すと、他の人が先に保存していた場合に 409 |
| `editable` `editableFrom` `editableTo` | 月ロック。今日(JST)が属する月の1日〜末日だけ編集できる(管理者も同じ) |
| `optionsI` `optionsR` | 天候の選択肢(`['晴れ','曇り','雨','雪']`。GAS版はシートの入力規則から読んでいた値を固定で持つ) |

### `PUT /api/attendance/day`

GAS版 `updatePastSchedule`。ボディ `{ date, staffId?, rowData, rowVersion? }`。

- 当月以外の日付は `400 {code:'locked', message:'修正期限切れです。当月(09/01)より前の記録は変更できません。'}`
  (来月以降は `'修正できません。来月以降(09/30より後)の記録はまだ修正できません。'`)。何も保存しない。
- **送られた列だけ**を現在値と比較し、値が変わった列だけを書く(送られていない列はそのまま。空文字で消せる)。
- 値の形式を確かめる(時刻は `HH:mm`、距離は小数2桁に揃える。誤りは `400 validation_failed`、`fields` は
  `rowData.<列>`)。訪問の時間帯の重なりは拒否しない(GAS版の `updatePastSchedule` も重なりを確かめずに書いていた。
  予定の正はカレンダーで、二重予約の防止は将来の予約の割当 `reservation_assignments` の EXCLUDE が受け持つ)。
  24:00 は翌日の 0:00 として持ち、出勤簿には `00:00` と出す(GAS版もシートの時刻を `HH:mm` で読むため `00:00`)。
- 変わった項目だけを実体(`visits`・`work_segments`・`travel_legs`・`attendance_days`)に差分で書き、変えた項目を
  `overridden_fields` に加え、`entity_changes` に変更前の値(暗号化)・変更した項目・操作者を追記する。その日の行は
  `SELECT … FOR UPDATE` で押さえ(カレンダーの反映と重ならない)、`attendance_day` のミラーを同じトランザクションで
  outbox に積む(`dedupe_key` は `mirror.attendance_day:<日のID>:<版>`。ペイロードの `columns` にその書き込みで表示の
  変わった列を持ち、ワーカーはその列だけを今の値で送る)。
- `rowVersion` が今の版と違えば `409 conflict`(WARN `attendance.day.update_conflict`)。締めた月
  (`attendance_periods`)は DB のトリガーも拒否する(`400 locked`)。
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

予定は `SchedulePort.getScheduleWithRoute({ staffId, staffName }, date, false, { tenantId, fresh: true })` から毎回最新を取る
(出勤簿は正式な記録のため共有キャッシュを読み書きせず、読めないカレンダーがあれば部分的な結果ではなく
`502 upstream_unavailable` にする。GAS版 `refreshAttendanceForStaffOnDate` と同じ規則)。予定の実装
(`SCHEDULE_PROVIDER` = google / gas_bridge / noop)は `doc/api/schedule-route.md` を参照。
変換と非破壊マージは `packages/core/src/domain/attendance/calendarSync.ts`(GAS版
`buildTimesheetRowDataFromAppointments_` / `mergeOverlappingOfficeWork` / `buildCalendarSyncPlan_` を移植し、
`gasParity.test.ts` でGAS版のコードそのものと出力一致を確認している)。**月ロックは掛からない**(GAS版と同じ)。

- カレンダーにある枠(訪問#1〜#3・事務作業#1〜#2)はカレンダーの内容で上書き。
- 出勤簿にだけある枠は、カレンダー由来の枠と時間が重なる場合だけクリアし、重ならなければ残す。
- 退勤距離は最後に埋まった訪問の枠と一緒に反映する。天候・買物代行・備考には触れない。
- `overridden_fields`(手で直した列の強調表示)は増やしも消しもしない。枠の値が全て空になって実体が消えても、印は枠に
  残し(`attendance_days.overridden_fields` に `visit:<枠>:<項目>` の形)、次にその枠に作る実体へ引き継ぐ(GAS版の強調表示は
  セルの背景色のため、値を書き直しても残っていた)。反映した訪問は `source = 'google_calendar'`、予定の顧客IDから
  顧客を結び付ける。4件目以降の訪問は枠外の訪問として保存する(出勤簿には出ない)。
- 時間の重なる予定(例: A 09:00–12:00 と B 11:30–13:00)もそのまま反映する(GAS版と同じ。以前は重なりを 400 にしており、
  その日の反映・夜間バッチが失敗していた)。
- 予定が無く、その日の出勤簿の行もまだ無いスタッフには何も作らない(空の行・勤怠集計のミラーを積まない)。行がある日は
  予定が全て消えても反映し、勤怠集計の行を書き直す。

### `GET /api/attendance/day/calendar-sync/preview?date=[&staffId=]`

GAS版 `previewCalendarSyncForStaffOnDate`。書き込みなし。レスポンス
`{ staffId, staffName, date, appointmentCount, hasChanges, changes: [{column, label, oldValue, newValue}] }`。

### `POST /api/attendance/day/calendar-sync`

GAS版 `applyCalendarSyncForStaffOnDate` / `syncPastScheduleFromCalendar`。ボディ `{ date, staffId? }`。
クライアントが見たプレビューは信用せず、同じ計算をやり直してから書く。

- **冪等**: 同じカレンダー内容なら2回目以降は `changedCount: 0` で、出勤簿の保存・履歴・`attendance_day` ミラーは
  行わない。「勤怠集計」(`attendance_aggregate`)のミラーは予定の内容(指紋)がその日の最後に積んだものと違うときに積む
  (ペイロード `{ fingerprint, seq }`、`dedupe_key` は `mirror.attendance_aggregate:<日のID>:<seq>`。予定が A → B → A と
  戻った場合も3回目を積む。同じ内容の再反映では積み直さない)。
- 変更があれば出勤簿を保存し、`entity_changes` に履歴(操作者つき、`change_source = 'calendar_sync'`)を追記する。
- レスポンス `{ staffId, staffName, date, appointmentCount, changedCount, changes }`。
- **管理者の期間一括反映**(GAS版の「一括反映」モーダル)は、クライアントがスタッフ×日ごとにこのAPIを順に呼び、
  成功/失敗数を数える(GAS版 `runCalendarSyncQueue` と同じ)。失敗分だけの再実行もそのまま行える。

### `POST /api/attendance/day/aggregate/refresh`(管理者のみ)

GAS版 `refreshAttendanceForStaffOnDate`。ボディ `{ date, staffId }`。「勤怠集計」シートの該当スタッフ・該当日の
行の書き直しを outbox に積む(個別出勤簿は書き換えない。予定の内容が同じでも毎回積む)。一般スタッフは `403`(WARNログ)。レスポンス
`{ staffId, staffName, date, appointmentCount, rowData }`(`rowData` はカレンダーから組み立てた参考値)。

## 顧客CSV・データ版数

### `POST /api/admin/customers/import`(管理者のみ)

GAS版 `forceImportCsv`。ボディ `{ force?: boolean }`(既定 `true`=取込済みの版でも取り込み直す)。
取込処理は下記 `csv-import` ジョブと同じ(`packages/ingestion/src/customerCsvImport/`)。操作した管理者のIDと名前を
`app_logs` に残す(管理者以外は `403`、`customer_csv.import.access_denied` をWARNログ)。レスポンス `{ status, message, fileName, version, stats, dataVersion }`、`status` は
`imported` / `up_to_date` / `no_files` / `not_configured`(200)、`review_required`(409)、`failed`(502)。

GAS版は顧客シートを丸ごと書き換えていたが、こちらは RESERVA 顧客IDでの差分適用で、CSVから消えた顧客が既存の
20%を超える場合は適用しない(`review_required`、版も進めない)。行の値の誤りで取込全体を止めない: 住所2の適用終了日が
開始日より前(前日を含む)なら期間なしで持ち(GAS版と同じく予定計算ではその住所を使わない)、登録日時等が読めなければ
空にし、顧客ID・氏名の無い行は飛ばす。数は `import_runs.counts`(`skipped`・`issue_<理由>`)とログ
(`customer_csv.imported` を WARN)に残す。内容を確認して取り込む場合は
`pnpm --filter @katahimo/api import:reserva -- <tenantSlug> <CSVパス> --force`。

> GAS版は画面を開くたびにクライアントから `checkAndImportLatestCsv` を呼んでいたが、新版では取込は定期ジョブと
> 管理者操作だけにした(多数の端末から重い取込処理が走らないように)。画面は下の版数ポーリングだけを行う。

### `GET /api/data-version`

GAS版 `checkDataVersion`。レスポンス `{ dataVersion: '12' }`(`tenant_settings.customer_data_version`。顧客CSVの取込で
何か変わるたびに+1。何も変わらない取込では上げない)。クライアントは60秒ごとに
ポーリングし、前回値と違えば顧客一覧を読み直す。

## バッチ(packages/worker)

| 実行単位 | コマンド | 内容 | Cloud Scheduler(JST) |
| --- | --- | --- | --- |
| 常駐 | `pnpm --filter @katahimo/worker start` | outbox(ミラー・再設定メール)の処理(Cloud Run サービス、最小インスタンス1) | — |
| ジョブ | `pnpm job:nightly-calendar-sync` | GAS版 `autoSyncTodayScheduleForAllStaff`: 利用中の全テナントの在籍スタッフの当日分をカレンダーから出勤簿へ反映。スタッフごとに失敗を記録して続行し、テナントごとのまとめを INFO ログ。冪等 | `0 22 * * *`(`CRON_TZ=Asia/Tokyo`) |
| ジョブ | `pnpm job:csv-import` | GAS版 `checkAndImportLatestCsv`: 各テナントの取込元の最新CSVが未取込なら取り込む | `0 3 * * *`(`CRON_TZ=Asia/Tokyo`) |
| ジョブ | `pnpm --filter @katahimo/worker job:maintenance` | 保守: 操作ログの月のパーティションの作成・削除、保存期間を過ぎた行(セッション・outbox・再設定コード・マッチングの候補・レート制限)と参照されないファイルの削除(doc/09 第6章) | `0 4 * * *`(`CRON_TZ=Asia/Tokyo`) |
| ジョブ | `pnpm --filter @katahimo/worker job:sync-busy-blocks` | スタッフのGoogleカレンダーの free/busy を `staff_busy_blocks` に同期(将来のマッチング用、doc/10。GAS版に相当機能なし)。期間は今日から `BUSY_BLOCK_SYNC_DAYS` 日 | 既定では登録しない(使う場合は例: `0 * * * *`) |
| 確認用 | `pnpm --filter @katahimo/worker outbox:once` | outbox を空になるまで(`OUTBOX_DRAIN_MAX` 件まで)処理して終了 | — |

- ジョブは Cloud Run Jobs として同じ worker イメージの別コマンドで動かす(ビルド済みの
  `node dist/<job>.js`。`<job>` は `nightly-calendar-sync` / `csv-import` / `maintenance` / `sync-busy-blocks` / `outbox-once`。
  構成は `Dockerfile` / `infra/gcp/run.tf`、手順は `doc/11_GCPデプロイ手順.md`)。
  失敗(反映に失敗したスタッフがいる・取込が `failed`/`review_required`・保守の処理の失敗)があると終了コード1になり、
  Cloud Run Jobs の再試行・アラートに乗る。`JOB_TIMEOUT_MS`(既定30分)を超えても終了コード1。SIGTERM を受けたら区切り
  (スタッフ・テナントの間)で止め、`WORKER_SHUTDOWN_TIMEOUT_MS` で強制終了する。区切りで止めた夜間反映・保守は
  最後まで終わっていないため終了コード1(`interrupted`。冪等なので再試行で残りを処理する)。
- 保守は消去されていない全てのテナント(停止中・解約済みを含む)が対象。操作ログの月のパーティションは12か月先まで作り、
  パーティションの無い月の行を受ける既定のパーティション(`app_logs_default`)の行を月のパーティションへ移す。ワーカーは専用の DB ユーザー
  `katahimo_worker`(`WORKER_DATABASE_URL`)で接続する。ログは1行JSON(Cloud Logging の構造化ログ)。
- 取りこぼした日の流し直し: `pnpm job:nightly-calendar-sync -- 2026-09-24`。
- ローカル開発では `WORKER_IN_PROCESS_CRON=true` で常駐ワーカーの中でも 22:00 / 03:00 / 04:00 JST に同じジョブを動かせる。
- 夜間反映の「当日」はテナントのタイムゾーンの今日、対象はその日に在籍しているスタッフ。
- 夜間反映は顧客CSV取込(03:00)で最新化された住所を前提にしている(GAS版 `Triggers.js` と同じ順序)。

### outbox の取り出しと再試行

メッセージは `outbox_messages`(書き込みと同じトランザクションで積む。`dedupe_key` が同じなら積み直さない)。
ワーカーはテナントを横断して `FOR UPDATE SKIP LOCKED` で1件ずつ取り出し、`processing`・`locked_until`
(`OUTBOX_LEASE_MS`、既定5分)にしてすぐコミットし、処理はトランザクションの外で行う。リースが切れた `processing`
(ワーカーの異常終了)は別のワーカーが取り直す(試行回数が `max_attempts` に達していれば取り直さず `dead`、ERROR ログ)。
結果(完了・再試行・諦め)は取り出したときのリース(`locked_by` と `attempts`)がまだ自分のものである場合だけ書く。
処理中にリースが切れて取り直されていたら何も書かず WARN(`outbox.lease_lost`)を残す(遅れて終わった古い処理が、
取り直した処理の結果を上書きしない)。失敗は `attempts` に応じて `available_at` を
`OUTBOX_RETRY_BASE_DELAY_MS × 2^(attempts-1)`(上限 `OUTBOX_RETRY_MAX_DELAY_MS`)だけ先送りして `pending` に戻し、
`last_error` を残す。メッセージごとの `max_attempts`(既定8)回失敗したら `dead` にして自動再試行をやめ、`app_logs` に
ERROR(`outbox.message_failed`)を残す。再試行しても直らない失敗(`PermanentOutboxError`)はすぐ `failed`。
`MIRROR_TO_GOOGLE_SHEETS` が無効ならミラーのトピックは送らずに完了にする。領収書の画像が見つからないミラーは送らずに
WARN(`mirror.receipt.image_missing`)を残して完了にする。GAS Bridge 呼び出しは HTTP エラー・JSON以外の応答・
タイムアウト(120秒)も失敗扱い。

## 環境変数

| 変数 | 使う側 | 内容 |
| --- | --- | --- |
| `SCHEDULE_PROVIDER` ほか `GOOGLE_MAPS_API_KEY` / `GOOGLE_APPLICATION_CREDENTIALS` / `GOOGLE_CALENDAR_IDS` / `GOOGLE_CALENDAR_IMPERSONATE` | API・ワーカー | 予定・ルート計算の実装(doc/api/schedule-route.md)。夜間反映のワーカーもAPIと同じ設定にする |
| `GAS_BRIDGE_URL` / `GAS_BRIDGE_SECRET` | API・ワーカー | GAS版 Web App(Bridge.js)。ミラー書き込み先(未設定ならミラー送信は何もしない)、`SCHEDULE_PROVIDER=gas_bridge` の予定取得元 |
| `BUSY_BLOCK_SYNC_DAYS` | ワーカー | `job:sync-busy-blocks` の同期期間(日、既定28) |
| `MIRROR_TO_GOOGLE_SHEETS` | API・ワーカー | `true`/`1` のときだけミラーを outbox に積む(API)・送る(ワーカー。無効なら完了にする) |
| `CUSTOMER_CSV_DRIVE_FOLDERS` | API・ワーカー | `{"テナントslug":"DriveフォルダID"}`。サービスアカウント(ADC / `GOOGLE_APPLICATION_CREDENTIALS`)に閲覧共有する。`Kokyaku_YYYYMMDDHHmm_N.csv` のうちファイル名の日時が最新のものを取り込む |
| `CUSTOMER_CSV_LOCAL_DIR` | API・ワーカー | ローカル開発用。`<dir>/<テナントslug>/` を取込元にする(Drive設定が無い場合のみ) |
| `WORKER_DATABASE_URL` | ワーカー | `katahimo_worker` の接続(API の `DATABASE_URL` とは別のユーザー) |
| `OUTBOX_POLL_INTERVAL_MS` / `OUTBOX_DRAIN_MAX` / `OUTBOX_LEASE_MS` | ワーカー | 既定 5000 / 100 / 300000 |
| `OUTBOX_RETRY_BASE_DELAY_MS` / `OUTBOX_RETRY_MAX_DELAY_MS` | ワーカー | 既定 30000 / 3600000(試行回数の上限はメッセージの `max_attempts`) |
| `WORKER_SHUTDOWN_TIMEOUT_MS` / `JOB_TIMEOUT_MS` / `APP_LOG_RETENTION_MONTHS` | ワーカー | 既定 8000 / 1800000 / 13 |
| `WORKER_IN_PROCESS_CRON` | ワーカー | `true` で常駐ワーカー内の定期実行を有効にする(ローカル用) |
| `WORKER_HEALTH_PORT` | ワーカー | 常駐ワーカーをヘルスチェック用に待ち受けさせるポート(Cloud Run サービス用。未設定なら待ち受けない) |

## GAS側(Bridge.js)

`legacy/` サブモジュールは読み取り専用のため、Bridge.js の変更は GAS版リポジトリ(`katahimo-dev/gas-childcare-visit-app`)で
行う。**書き込み action の本番への配置は Bridge.js Ver. 1.1.38 以降にすること**(それより前の版は下の2点が誤っている)。

- `writeAccidentReport`(Ver. 1.1.38 で修正): 「事故報告」シートの列は GAS版 `saveAccidentReport` と同じ16列
  (5・6列目が対象児の氏名 `targetName`・生年月日 `targetDob`)+ 17列目 `KatahimoReportId`。Ver. 1.1.37 までは
  対象児の2列が抜けて7列目以降がずれ、`getCustomerReports`(`row[6]`〜`row[15]`)が別の項目を表示していた。
  上書き(同じ `reportId`)で事故報告とヒヤリハットを切り替えると、同じ行の種別の列が変わる(GAS版と同じ)。
- `writeReceipt`(Ver. 1.1.38 で修正): ペイロードの `receiptId` を「領収書一覧」の9列目 `KatahimoReceiptId` で追跡し、
  同じIDが既にあれば何もしない(`{ success: true, alreadyMirrored: true }`。outbox の再送で Drive へのアップロード・行を
  二重にしない)。重複の判定(日時+スタッフ+顧客+金額+店名)は本アプリで済んでいるため Bridge.js ではしない
  (Ver. 1.1.37 までは GAS版 `processReceiptImages` を1枚ずつ呼んでおり、同じ登録の中の同じ内容の2枚目(往復の運賃等)が
  落ちていた)。
- `writeAttendanceDay`: `values` にはその書き込みで表示の変わった列だけが入る(空にした列は `''`)。Bridge.js は
  `values` にある列だけを書くため、シートにだけある値(本アプリに取り込んでいない列)は残る。ペイロードの
  `highlightColumns: string[]`(`values` の列のうち手で変えた列)の強調表示は未対応(対応する場合は書き込み後に次を足す。
  GAS版 `updatePastSchedule` の `cell.setBackground('#fce4e4')` と同じ表示)。

  ```js
  (payload.highlightColumns || []).forEach(function (colChar) {
    if (!(colChar in PAST_SCHEDULE_INPUT_COLUMNS)) return;
    target.sheet.getRange(target.rowNumber, pastScheduleColumnToNumber_(colChar)).setBackground('#fce4e4');
  });
  ```
- `writeAttendanceAggregate`: 変更不要(ペイロード `{ staffName, businessDate }`。行の中身はGAS側がカレンダーと
  Maps から計算し直し、該当スタッフ・該当日の既存行を消してから書くため再送しても重複しない)。
  予定の取得を新版の SchedulePort(Google Calendar + Maps の直接呼び出し)に切り替えた後も、勤怠集計シートの
  行はGAS側の計算のままになる点に注意(両者の計算結果を揃えたい場合は、将来 `rows` をペイロードで渡す action を
  追加する)。
- **共有シークレットの受け取り方**(推奨、セキュリティレビュー 2026-09): 新版は Bridge.js への要求に
  シークレットを `X-Katahimo-Bridge-Secret` ヘッダーとURLクエリ `secret` の両方で付けている。Apps Script の Web App
  (`doGet(e)` / `doPost(e)`)はリクエストヘッダーを読めないため、現行の Bridge.js はクエリの `secret` で認証しており、
  クエリは外せない(URLはGoogle側のアクセスログ等に残りやすい)。Bridge.js を次のように変えたら、新版
  (`packages/integrations/src/gas-bridge/gasBridgeClient.ts`)の POST からクエリの `secret` を外す:
  - `doPost`: `verifyBridgeSecret_(params.secret)` を、本体の JSON(`JSON.parse(e.postData.contents).secret`)の
    値でも認証できるようにする(移行期間は両方を受け付ける)。書き込み処理は本体の `secret` を無視するようにする。
  - 読み取り系(`doGet` の `?api=1`、ジオコーディング・ルート計算・予定)も POST(本体に `secret`)で受け付ける
    action を足す(GET には本体が無いため、クエリ以外にシークレットを載せる場所が無い)。
- GAS版の時限トリガー `autoSyncTodayScheduleForAllStaff` / `checkAndImportLatestCsv`(`Triggers.js`)は、新版の
  ジョブを本番で動かし始めたら `setupAllTriggers()` の定義で `enabled: false` にして止める(二重反映・二重取込を
  避けるため)。

## 既存の出勤簿の取込(切り替えの準備)

`pnpm --filter @katahimo/api import:attendance -- <tenantSlug> <スタッフのログインメール> <CSVの絶対パス> [--year YYYY]`

個別出勤簿(`<スタッフ名>_出勤簿_<年度>年度` の月のシート)を CSV に書き出したもの(「ファイル → ダウンロード → CSV」)を、
そのスタッフの出勤簿の実体に取り込む(`packages/ingestion/src/attendanceSheetCsv/` で読み、
`importAttendanceSheetRows` が1日ずつ `applyRowEdit` で当てる)。A列が日付の行だけを読み(年の無い表記は `--year`)、
入力列(C〜AO)の位置は `sheetLayout.ts` の列の定義から決める。1日ずつ別のトランザクションで差分を書き
(`entity_changes.change_source = 'import'`)、同じ内容の再実行は何も書かない。当月の編集期限は掛けない(締めた月は
DB が拒否)。スプレッドシートへのミラーは積まない。CSV には背景色が無いため、手で変えた強調表示は取り込まない。
形式の読めないセルはそのセルだけ飛ばして表示する。使い方は doc/11 §7。
