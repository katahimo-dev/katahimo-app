# 04. API 仕様

- 目的: HTTP API の全エンドポイントと、共通の約束(認証・エラー・CSRF・回数制限・本体の上限・ヘッダー)を決める。
- 対象読者: API・画面を直す開発者、API を使う連携を作る人、セキュリティレビュー。

正はコード: ルート `packages/api/src/routes/*.ts`(登録は `src/app.ts`)、契約 `packages/shared/src/contracts/*.ts`
(下の表の「契約」はそこにある zod スキーマの名前)、共通処理 `packages/api/src/http/`、セッション `src/session.ts`。
業務ルールの詳細は [02_機能仕様.md](02_機能仕様.md)、セキュリティの考え方は [06_セキュリティ設計.md](06_セキュリティ設計.md)。

## 1. 共通の約束

### 1.1 形式

- ベースは同じオリジンの `/api/*`(本番は API が Web 画面も配信する)。要求・応答は JSON(UTF-8)。
- 日付は業務日 `YYYY-MM-DD`(`businessDateSchema`)、年月 `YYYY-MM`、時刻 `HH:MM`、ID は UUID(`idSchema`)。日時は ISO 8601。
- 入力は `parseJsonBody` / `parseQuery` で契約に通す(失敗は 400)。成功の応答は `jsonOk(c, schema, body)` で**応答の契約にも
  通してから**返す(食い違いは 500 になりログに残る。契約に無い項目は落ちる)。画面(`web/src/api/client.ts`)も同じ契約で応答を検証する。
- 自由記述の欄(日報・事故報告の本文、領収書の店名・引き継ぎ、出勤簿のセル、AI のプロンプト、スタッフの氏名・電話 等)は、
  契約(`freeText`)でタブ・改行・復帰以外の制御文字(U+0000 等)を取り除いてから使う(PostgreSQL は U+0000 を保存できない)。
  顧客CSV・スタッフ台帳・出勤簿の CSV の取込も同じ規則で取り除く(`stripControlChars`)。
- `tenantId` は**セッション Cookie からだけ**決まる(外部システム連携の `/api/integrations/*` だけは API キーから。2.11)。
  要求の本体・クエリに入れても使わない。

### 1.2 認証とセッション Cookie

| 項目 | 内容 |
| --- | --- |
| Cookie 名 | 本番 `__Host-katahimo_session`(Secure・Path=/・Domain なし)、開発 `katahimo_session` |
| 属性 | `HttpOnly`・`SameSite=Lax`・`Path=/`・本番は `Secure`。期限は無操作の期限 |
| 値 | `<テナントID>.<生トークン>`。DB は生トークンの SHA-256 だけを持つ(`sessions.token_hash`) |
| 期限 | 無操作7日(`SESSION_IDLE_TTL_MS`)。残りが6日を切った要求で7日に延ばし Cookie も更新。ログインから30日(`SESSION_ABSOLUTE_TTL_MS`)を超えない |
| 毎回の確認 | セッション(失効・期限)→ テナントが `active` → スタッフの存在 → 退職日(テナントの時刻帯の業務日)。退職済みならそのスタッフの全セッションを失効 |
| ミドルウェア | `requireSession(container, deniedAction?)`(未ログイン 401。`deniedAction` があれば WARN `<action>.access_denied`)、`requireAdmin(container, action)`(未ログイン 401・管理者以外 403、どちらも WARN)、`requireCoordinator(container, action)`(同じくコーディネーター・管理者以外 403) |
| 対象スタッフ | `targetStaffIdOf(c, staffId)`: 一般スタッフは常に本人、コーディネーター・管理者は指定があればそのスタッフ(usecase でも確かめる) |

### 1.3 エラー

全てのエラーは `{ code, message, fields? }`(`apiErrorSchema`)。`message` は画面にそのまま出せる日本語。

| code | HTTP | 主な場面 |
| --- | --- | --- |
| `unauthenticated` | 401 | 未ログイン・セッション切れ・ログイン失敗・外部連携の API キーが無い・誤り・失効(`WWW-Authenticate: Bearer`) |
| `forbidden` | 403 | 役割が足りない・他人の報告の上書き・CSRF |
| `not_found` | 404 | 無い ID・無いルート(「該当するAPIがありません」) |
| `validation_failed` | 400 / 413 / 415 | 入力の誤り(`fields` に項目ごとの最初の文言。キーは `rowData.D` のような経路)、本体が大きすぎる(413)、JSON 以外(415) |
| `locked` | 400 | 月ロック・締めた月・確定済みの記録 |
| `conflict` | 409 | 古い `rowVersion`・重複・顧客/担当の違う上書き・顧客CSV の `review_required` |
| `rate_limited` | 429 | 回数制限(`Retry-After` ヘッダーに秒数) |
| `upstream_unavailable` | 502 | 外部サービス(カレンダー・地図・Gemini・Drive)の失敗。詳細はログにだけ |
| `internal` | 500 | 想定外の例外(「サーバーでエラーが発生しました。…」)。詳細とリクエストIDはプロセスログにだけ |

usecase は `DomainError(code, message, fields?, reason?)` を投げ、`app.onError(onApiError)` が1か所で `DOMAIN_ERROR_STATUS` に
従って応答にする(`http/responses.ts`)。

### 1.4 共通のミドルウェア(`app.ts` の順)

| 順 | 対象 | 処理 |
| --- | --- | --- |
| 1 | 全て | `requestLogger`: 1要求1行の構造化ログ。リクエストIDは `X-Cloud-Trace-Context` のトレースID、無ければ UUID。応答の `X-Request-Id` に返す。クエリ・本文は記録しない |
| 2 | 全て | `clientIpMiddleware`: 送信元IPは `X-Forwarded-For` の右から `TRUSTED_PROXY_HOPS` 番目(未指定は本番1・それ以外0 = 接続元) |
| 3 | 全て | `securityHeaders`: CSP・`X-Content-Type-Options: nosniff`・`X-Frame-Options: DENY`・`Referrer-Policy: strict-origin-when-cross-origin`・COOP/CORP same-origin・Permissions-Policy・本番だけ HSTS(1年)(06) |
| 4 | `/api/*` | `Cache-Control: no-store` |
| 5 | `/api/*` | CSRF: 状態を変える要求(POST/PUT/PATCH/DELETE)は `Sec-Fetch-Site` が `same-origin` / `none` 以外なら 403。`Sec-Fetch-Site` が無ければ `Origin` のホストが `Host` と違えば 403。どちらも無い要求(ブラウザ以外)は通す |
| 6 | `/api/*` | 本体のある状態変更の要求は `Content-Type: application/json` だけ(415) |
| 7 | `/api/*` | 本体の上限: 既定 256KB、`POST /api/receipts` 14MB、`POST /api/receipts/ocr` 3MB、`POST /api/integrations/customers` 2MB(413) |

### 1.5 回数制限

`platform.rate_limit_buckets` に固定窓で数える(Cloud Run の複数インスタンスで共有)。キーは `SESSION_SECRET` から HKDF で
導出した鍵つきハッシュ(IP・ログインIDを平文で残さない)。規則は `core/usecases/rateLimits.ts` の `DEFAULT_RATE_LIMIT_POLICY`、
回数だけ環境変数で変えられる。超えると WARN `rate_limit.exceeded`(規則名・回数)。

| 規則(name) | キー | 既定 | 超えたとき | 回数の環境変数 |
| --- | --- | --- | --- | --- |
| `login_failure_account` | テナントslug + 正規化したログインID(無いアカウントも数える) | 15分に10回 → 15分ロック | 429(正しいパスワードでも) | `RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT` |
| `login_failure_ip` | 送信元IP | 15分に50回 → 15分ロック | 429 | `RATE_LIMIT_LOGIN_FAILURES_PER_IP` |
| `password_reset_request_account` | アカウント | 1時間に5回 | 何もせず同じ応答(既存のコードに触れない) | `RATE_LIMIT_PASSWORD_RESET_REQUESTS_PER_ACCOUNT` |
| `password_reset_request_ip` | IP | 1時間に20回 | 429 | `RATE_LIMIT_PASSWORD_RESET_REQUESTS_PER_IP` |
| `password_reset_confirm_account` / `_ip` | アカウント / IP | 1時間に20回 / 50回 | 429 | — |
| `ai_generate_staff` | テナント + スタッフ | 1日200回 | 429 | `RATE_LIMIT_AI_GENERATE_PER_STAFF_DAY` |
| `receipt_ocr_staff` | テナント + スタッフ | 1日300回 | 429 | `RATE_LIMIT_RECEIPT_OCR_PER_STAFF_DAY` |
| `schedule_force_refresh_staff` | テナント + スタッフ | 1時間30回 | 429 | `RATE_LIMIT_SCHEDULE_REFRESH_PER_STAFF_HOUR` |
| `push_test_staff` | テナント + スタッフ | 1時間10回 | 429 | — |
| `push_subscribe_staff` | テナント + スタッフ | 1時間30回 | 429 | — |
| `integration_customers_key` | テナント + 外部連携の API キー | 1時間120回 | 429 | — |
| `integration_auth_failure_ip` | 送信元IP(`/api/integrations/*` の認証の失敗) | 15分に30回 → 15分ロック(ロック中は認証もしない) | 429 | — |
| `attendance_export_staff` | テナント + スタッフ | 1時間30回(出勤簿の Excel の書き出し。1人分・全員分の合計) | 429 | — |

ログインの2つの規則は照合(argon2)の**前に**1回分の枠を取る(同時の大量の試行でも照合まで進むのは上限の回数まで)。
一致した回は数えない(アカウントは数え直し、IP は先に取った1回分を返す)。
`integration_auth_failure_ip` も同じく API キーを確かめる前に1回分を取り、成功した回は返す。ロック中の要求は `rate_limit.exceeded` も
`integration.auth_failed` も残さず(失敗の続く連携先で操作ログが溢れないように)、ロックの始まりに1回だけ WARN `integration.auth_locked` を残す。

## 2. エンドポイント一覧

権限: 「誰でも」= 未ログイン可、「ログイン」= `requireSession`、「管理者」= `requireAdmin`。
`staffId?` は管理者・コーディネーターだけが有効な対象スタッフの指定(一般スタッフは無視されて本人)。

### 2.1 ヘルスチェック

| メソッド・パス | 権限 | 応答 | 備考 |
| --- | --- | --- | --- |
| `GET /api/health` | 誰でも | `{ status: 'ok' }` | DB に触らない(Cloud Run の起動・生存確認) |
| `GET /api/health/db` | 誰でも | `{ status: 'ok' }` / 503 `{ status: 'error' }` | 失敗の詳細はプロセスログにだけ |

### 2.2 認証 `/api/auth`(`routes/auth.ts`)

| メソッド・パス | 権限 | 契約(要求 / 応答) | 応答・エラー | 主なログ |
| --- | --- | --- | --- | --- |
| `POST /login` | 誰でも | `loginRequestSchema`(`tenantSlug`・`email`(サブメールも可)・`password`)/ `sessionUserResponseSchema` | `{ staff: { staffId, tenantId, name, email, role } }` + Cookie。401「メールアドレスまたはパスワードが違います」/「ログイン権限のないユーザーです」(退職)/「ご利用の法人は現在利用を停止しています。…」、429(ロック中) | INFO `auth.login.succeeded`、SECURITY `auth.login.failed`・`.lockout_started`・`.locked` |
| `GET /me` | 誰でも(Cookie) | — / `sessionUserResponseSchema` | 401「未ログインです」 | INFO `auth.session.auto_login` / WARN `.auto_login_failed` |
| `POST /logout` | 誰でも | — / `okResponseSchema` | `{ ok: true }`。セッションを失効し Cookie を消す | INFO `auth.logout` |
| `POST /change-password` | ログイン | `changePasswordRequestSchema`(`currentPassword`・`newPassword` 8〜128文字)/ `changePasswordResponseSchema` | 400「現在のパスワードが正しくありません」・長さの規則。操作中以外のセッションを失効 | SECURITY `auth.password_change.succeeded` / `.failed` |
| `POST /password-reset/request` | 誰でも | `passwordResetRequestSchema`(`tenantSlug`・`email`)/ `passwordResetRequestResponseSchema` | 常に `{ ok: true, message }`。IP の上限だけ 429 | SECURITY `auth.password_reset.requested`、WARN `.request_rejected` |
| `POST /password-reset/confirm` | 誰でも | `passwordResetConfirmSchema`(`tenantSlug`・`email`・`code` 6桁・`newPassword`)/ `passwordResetConfirmResponseSchema` | 400「無効な認証コードです」/「認証コードの有効期限が切れています」/入力回数の上限、429 | SECURITY `auth.password_reset.completed`、WARN `.failed` |

### 2.3 お客様 `/api/customers`(`routes/customers.ts`、全てログイン)

| メソッド・パス | 契約 | 応答 | 備考 |
| --- | --- | --- | --- |
| `GET /?familyName=` | `customerListQuerySchema` / `customerListResponseSchema` | `{ customers: [{ id, name, phone, city }], cities }` | `familyName` 省略でアーカイブされていない全件(絞り込みは画面)。指定すると苗字の完全一致 |
| `GET /:id` | — / `customerDetailResponseSchema` | 住所・連絡先・子ども(アレルギー等)の全項目 | 形の違う ID は 404。INFO `customer.detail.viewed`(`details.customerId`) |

### 2.4 予定 `/api/schedule`(`routes/schedule.ts`、全てログイン)

| メソッド・パス | 契約 | 応答 | 備考 |
| --- | --- | --- | --- |
| `GET /?date=&staffId?` | `scheduleQuerySchema` / `scheduleLightResponseSchema` | 予定の一覧(ルートなし) | 地図 API を呼ばない。成功はログに残さない |
| `GET /route?date=&staffId?&forceRefresh?` | `scheduleRouteQuerySchema` / `scheduleWithRouteResponseSchema` | 予定 + 区間ごとの所要時間・距離・経路URL | `forceRefresh=1` はキャッシュを読まない(回数制限あり)。INFO `schedule.route.succeeded`、502(外部の失敗) |
| `GET /api/staff` | — / `activeStaffListResponseSchema` | `{ staff: [{ id, name }] }`(退職者を除く) | 一般スタッフには空の一覧(`routes/staff.ts`) |

### 2.5 出勤簿 `/api/attendance`(`routes/attendance.ts`、全てログイン)

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー |
| --- | --- | --- |
| `GET /day?date=&staffId?` | `attendanceDayQuerySchema` / `attendanceDayResponseSchema` | `{ attendance: { businessDate, staffId, staffName, found, rowData, derived, changedFields, rowVersion, editable, editableFrom, editableTo, optionsI, optionsR } }` |
| `PUT /day` | `updateAttendanceDayRequestSchema`(`date`・`staffId?`・`rowData`・`rowVersion?`)/ `updateAttendanceDayResponseSchema` | `{ attendance, changedCount, changedColumns, message }`。400 `locked`(月ロック・締めた月)・`validation_failed`(`rowData.<列>`)、409(古い `rowVersion`、WARN `attendance.day.update_conflict`) |
| `GET /day/calendar-sync/preview?date=&staffId?` | `calendarSyncQuerySchema` / `calendarSyncPreviewResponseSchema` | `{ staffId, staffName, date, appointmentCount, hasChanges, changes: [{ column, label, oldValue, newValue }] }`。書き込みなし。502 |
| `POST /day/calendar-sync` | `calendarSyncApplyRequestSchema`(`date`・`staffId?`)/ `calendarSyncApplyResponseSchema` | `{ staffId, staffName, date, appointmentCount, changedCount, changes }`。冪等。月ロックは掛からない。502 |
| `POST /day/aggregate/refresh` | `refreshAttendanceAggregateRequestSchema`(`date`・`staffId`)/ `refreshAttendanceAggregateResponseSchema` | **管理者だけ**(usecase が確かめる。403)。勤怠集計のミラーを積み、参考の `rowData` を返す |
| `GET /month?month=&staffId?` | `attendanceMonthQuerySchema` / `attendanceMonthResponseSchema` | `{ month: { yearMonth, staffId, staffName, days, totals, receipts: { byDay, total } } }`(月の全日) |
| `GET /week?start=&end=&staffId?` | `attendanceWeekQuerySchema` / `attendanceWeekResponseSchema` | `{ events: [{ date, slotKey, title, eventType, start, end }] }`(最大31日) |
| `GET /export?month=\|fiscalYear=&staffId?` | `attendanceExportQuerySchema`(`month` か `fiscalYear` のどちらか一方)/ .xlsx | 出勤簿の Excel(`XLSX_CONTENT_TYPE`)。1か月は1シート、年度(4月〜翌3月)は12シート。対象スタッフの決め方は `/month` と同じ。`Content-Disposition: attachment; filename="attendance_<月>.xlsx"; filename*=UTF-8''<日本語の名前>`(RFC 5987)、`Cache-Control: no-store`。中身は 02 8.6。INFO `attendance.export.downloaded`(自分の分も)。回数制限 `attendance_export_staff`(429) |
| `GET /export/all?month=` | `attendanceBulkExportQuerySchema` / .xlsx | **管理者だけ**(`requireAdmin`、他は 403 + WARN `attendance.export_all.access_denied`)。その月に在籍している全員を1人1シート(100人まで、超えると 400)。SECURITY `attendance.export_all.downloaded`(`staffCount`。全スタッフの記録を持ち出すため、操作ログの CSV と同じ扱い)。回数制限は上と共通。1つのサーバーで同時に1つだけ(重なれば 429) |

`rowData` のキーは出勤簿の列記号(`C`・`D`・`E` … `AO`。意味は `sheetLayout.ts` の `ATTENDANCE_COLUMNS`)、値は文字列。
書き込みは全て INFO、失敗・拒否は WARN/ERROR、閲覧は管理者・コーディネーターが他のスタッフを見たときだけ INFO(`targetStaffId`)。

### 2.6 日報・事故報告 `/api/reports`(`routes/reports.ts`・`routes/reportCsv.ts`、全てログイン)

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー |
| --- | --- | --- |
| `POST /daily/generate` | `generateReportRequestSchema`(`text` 1〜20,000字・`start?`・`end?`)/ `generateDailyReportResponseSchema` | `{ draft: { warnings, internal, customer } }`。失敗もエラーにせず `warnings` に `API Error` / `API Key Missing`(GAS版と同じ)。回数制限 |
| `POST /accident/generate` | 同上 / `generateAccidentReportResponseSchema` | `{ draft: {…8項目} | { error } }`。回数制限は日報と共通 |
| `POST /daily` | `saveDailyReportRequestSchema`(`reportId?`・`rowVersion?`・`staffId?`・`customerId`・`reportDate?`・`startTime`・`endTime`・`inputText`・`internalText`・`customerText`・`riskRating?`・`esRating?`)/ `saveDailyReportResponseSchema` | `{ success, message: '保存しました', report }`(`report.rowVersion` を含む)。404 `report_not_found`、403(他人の報告。SECURITY `report.daily.save_denied`)、409 `customer_mismatch` / `author_mismatch` / 古い版、400 `locked` |
| `POST /accident` | `saveAccidentReportRequestSchema`(`reportType: '事故報告'｜'ヒヤリハット'`・`targetName`・`targetDob`・`occurrenceTime`・`location`・`accidentContent`・`situation`・`immediateResponse`・`parentCorrespondence`・`diagnosisTreatment`・`prevention`・`inputText` と上の共通項目)/ `saveAccidentReportResponseSchema` | `{ success, report }`。事故報告とヒヤリハットは上書きで切り替えられる。日報との切り替えは 404。エラーは日報と同じ |
| `POST /visit-complete` | `visitCompleteRequestSchema`(`staffId?`・`customerId`・`visitDate`・`startTime`・`endTime`)/ `visitCompleteResponseSchema` | `{ success: true }`。DB に書かず Google Chat に知らせるだけ |
| `GET /history?customerId=&before?` | `customerHistoryQuerySchema` / `customerHistoryResponseSchema` | `{ items, nextCursor }`(5件ずつ、`(occurred_at DESC, id DESC)` のキーセット。続きが無ければ `null`)。読めない `before` は 400 |
| `GET /?from&to&staffId&customerId&kind&cursor&limit` | `reportListQuerySchema`(`from?`・`to?`(記録の日時の業務日、両端を含む。既定は今日までの31日間、366日まで)・`staffId?`(書いたスタッフ。一般スタッフは無視して本人)・`customerId?`・`kind?`(`daily_report` / `accident` / `near_miss`)・`cursor?`・`limit`(1〜100、既定30))/ `reportListResponseSchema` | `{ reports: [{ id, kind, occurredAt, date, time, staffId, staffName, customerId, customerName, excerpt, riskRating, esRating, updatedAt }], nextCursor, range: { from, to }, timeZone }`。新しい順(`(occurred_at DESC, id DESC)` のキーセット)。`time` は日報なら「開始〜終了」、事故報告は記録の時刻 `HH:mm`。`excerpt` は60文字まで。期間の誤りは 400(`fields.from`)、読めない `cursor`(壊れた形・UUID でない ID・2000〜2100年の外や存在しない日時)は 400 `invalid_cursor`。他のスタッフの記録を含むページは続きのページも1ページごとに INFO `report.list.viewed`(条件・件数・続きのページか `continued`。スタッフを絞れば `targetStaffId`) |
| `GET /export.csv?sheet&from&to&staffId&customerId&kind` | `reportCsvQuerySchema`(`sheet`: `daily` / `accident` 必須、`kind` は `sheet` に合うものだけ)。コーディネーター・管理者だけ(`requireCoordinator`、それ以外は 403・WARN `report.list.export.access_denied`) | `text/csv; charset=utf-8`(BOM つき、CRLF、`attachment; filename="reports-<sheet>_<from>_<to>.csv"`)。`daily` は GAS版の「日報」シートと同じ12列(日時・開始時刻・終了時刻・スタッフ・顧客ID・お客様・書いたメモ・事務局に送る文・保護者に送る文・PSI・ES・記録ID)、`accident` は「事故報告」シートと同じ17列(日時・報告者・顧客ID・お客様・対象児童名・生年月日・発生日時・発生場所・事故内容・発生状況・発生時の対応・保護者への対応・診断名・処置・今後の対応・元のメモ・種別(事故報告/ヒヤリハット)・記録ID)に、どちらも「最終更新」を足す。日時はテナントのタイムゾーンの `yyyy/MM/dd HH:mm:ss`、顧客IDは取込元(RESERVA)のID(無ければ本アプリのID。ミラーと同じ)。500件ずつ別のトランザクションで読んで流す。式として動く値・切断・途中の失敗の扱いは操作ログの CSV と同じ(`http/csv.ts` `writeCsvStream`)。読み始める前に SECURITY `report.list.exported`(条件と `sheet`) |
| `GET /:id` | — / `reportDetailResponseSchema` | `{ report: { id, kind, occurredAt, date, time, updatedAt, staffId, staffName, customerId, customerName, rowVersion, revisionCount, content, (日報は riskRating・esRating) }, timeZone }`。`content` は日報なら `startTime`〜`customerText`、事故報告・ヒヤリハットなら `targetName`〜`inputText`。`revisionCount` は `care_record_revisions` の件数。一般スタッフは本人の記録だけ(他人は 403・SECURITY `report.detail.view_denied`)。無い・別テナント・UUID でない ID は 404。他のスタッフの記録を読んだら INFO `report.detail.viewed`(`targetStaffId`) |

担当スタッフ: 一般スタッフは常に本人。管理者・コーディネーターは `staffId` → 上書きなら元の担当 → 本人の順。保存成功で
INFO `report.<daily|accident>.saved`(他人名義なら `targetStaffId`)。Google Chat の未設定は WARN
`notification.gchat.not_configured`、送信失敗は ERROR `notification.gchat.failed`(保存は成功のまま)。

### 2.7 領収書 `/api/receipts`(`routes/receipts.ts`、全てログイン)

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー |
| --- | --- | --- |
| `POST /ocr` | `receiptOcrRequestSchema`(`image` data URL)/ `receiptOcrResponseSchema` | `{ result: { amount, storeName, receiptDate, error? } }`。画像の形式・大きさの誤りは 400「領収書画像の形式が正しくないか、大きすぎます(JPEG・PNG・WebP、1枚1.5MBまで)。」。回数制限 |
| `POST /` | `uploadReceiptsRequestSchema`(`staffId?`・`customerId?｜null`・`customerNameText?`(200字)・`images: [{ data, amount?, storeName?, receiptDate? }]`(1〜6枚)・`receiptTimestamp?`・`reportDate?`・`startTime?`・`handoffText?`)/ `uploadReceiptsResponseSchema` | `{ success, message, uploadedCount, duplicateCount, duplicates, uploadBatchId }`。1枚でも画像が不正なら何も保存せず 400(`fields` に `images.<番号>.data`)。INFO `receipt.uploaded` |

画像の種類は data URL の申告ではなく中身の先頭バイトで判定する(JPEG・PNG・WebP)。保存の Content-Type・拡張子は判定した種類。
日時のフォールバック: 画像ごとの `receiptDate`(表記を問わない)→ `receiptTimestamp` → `reportDate` + `startTime` → 登録時刻。

一覧・画像・CSV(GAS版では管理者が「領収書一覧」シートと Drive で見ていたもの):

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー |
| --- | --- | --- |
| `GET /?month=YYYY-MM&staffId?&allStaff?&customerId?&cursor?&limit?` | `receiptListQuerySchema` / `receiptListResponseSchema` | `{ receipts, nextCursor, yearMonth, staff, summary: { count, totalYen, noAmountCount }, timeZone }`。領収書日時(テナントのタイムゾーンの月)の新しい順に `limit`(既定50・最大200)件ずつ、`(receipted_at DESC, id DESC)` のキーセット。`summary` はページではなく月全体(金額の無いものは0円)。各行は日時・スタッフ・お客様(登録済みは表示名、未登録は入力された氏名、指定なしは `null`)・金額・店名・束の申し送り(`handoffText`)・束のID(`uploadBatchId`)・画像の種類と大きさ。一般スタッフは本人の分だけ(`staffId` は無視して本人、`allStaff=true` は 403 + WARN `receipt.list.view_denied`)。管理者・コーディネーターは `staffId` で他のスタッフ、`allStaff=true` で全スタッフ分(`staff: null`)。存在しない・他テナントのスタッフ・お客様は 404、読めない `cursor`(壊れた形・UUID でない ID・2000〜2100年の外や存在しない日時)は 400 `invalid_cursor`。他のスタッフ・全スタッフ分は続きのページも1ページごとに INFO `receipt.list.viewed`(月・月全体の件数・続きのページか `continued`・そのページの件数 `pageCount`) |
| `GET /csv?month=&staffId?&allStaff?&customerId?` | `receiptListQuerySchema`(`cursor`・`limit` は使わない)/ CSV | 管理者・コーディネーターだけ(一般スタッフは 403 + WARN `receipt.list.export_denied`)。条件に合う全件(新しい順、500件ずつ読む)。BOM つき UTF-8・見出し「領収書日時,スタッフ,お客様,金額(円),店名,申し送り,登録の束ID,領収書ID」、ファイル名 `receipts_<YYYY-MM>_<staff|all>.csv`。式として動く値は先頭に `'`。途中で失敗したら最後の行に失敗の印。INFO `receipt.list.exported` |
| `GET /:id/image` | — / 画像 | 本人の領収書、管理者・コーディネーターは全員の領収書。API が中身をそのまま返す(`Content-Type` は中身の先頭バイトで判定し直した JPEG / PNG / WebP、`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`、`Content-Disposition: inline`)。一般スタッフの他人の領収書は 403 + WARN `receipt.image.view_denied`。無い・他テナント・ID でない値は 404。ファイル置き場に無い・画像でない中身は 404 + WARN `receipt.image.unavailable`(`reason: missing｜unsupported_type`)。1枚ごとの閲覧は記録しない(一覧の閲覧を記録する。06 5章) |

### 2.8 設定

| メソッド・パス | 権限 | 契約(要求 / 応答) | 応答・ログ |
| --- | --- | --- | --- |
| `GET /api/ui-config` | ログイン | — / `uiConfigResponseSchema` | `{ dailyPlaceholder, accidentPlaceholder, accidentHint, hiyariPlaceholder, assessments }`(テナントの上書き → `defaults/aiPrompts.ts`) |
| `GET /api/data-version` | ログイン | — / `dataVersionResponseSchema` | `{ dataVersion: '12' }`(`tenant_settings.customer_data_version`) |
| `GET /api/settings/admin` | 管理者 | — / `adminSettingsResponseSchema` | `{ settings: { geminiApiKey, geminiApiKeySet, geminiReportModel, geminiOcrModel, gchatReportWebhookUrl, gchatReportWebhookUrlSet, gchatReceiptWebhookUrl, gchatReceiptWebhookUrlSet } }`。秘密値は伏せ字 |
| `POST /api/settings/admin/gemini-key` | 管理者 | `saveGeminiApiKeyRequestSchema`(`apiKey` 500字まで)/ `saveSettingsResponseSchema` | `{ ok, changed, message }`。空・伏せ字の一部だけ書き換えは 400。SECURITY `settings.gemini_api_key.changed` |
| `POST /api/settings/admin/gemini-models` | 管理者 | `saveGeminiModelsRequestSchema`(`reportModel`・`ocrModel`)/ 同上 | SECURITY `settings.gemini_models.changed` |
| `POST /api/settings/admin/gchat-webhooks` | 管理者 | `saveGchatWebhooksRequestSchema`(`reportWebhookUrl?`・`receiptWebhookUrl?`)/ 同上 | 新しい値は `https://chat.googleapis.com/v1/spaces/<space>/messages?…` だけ。SECURITY `settings.gchat_webhooks.changed`、WARN `.save_rejected` |
| `POST /api/settings/admin/gemini-models/available` | 管理者 | `listGeminiModelsRequestSchema`(`apiKey?`)/ `listGeminiModelsResponseSchema` | `{ success, models }`。キー無し 400、API 失敗 502 |
| `GET /api/settings/admin/prompts` | 管理者 | — / `aiPromptListResponseSchema` | `{ prompts: [{ key, kind, label, body, defaultBody, customized, updatedAt, revision }] }`。`revision` はキーの最新の版(履歴 `ai_prompt_revisions` の最大値。保存したことが無ければ 0) |
| `PUT /api/settings/admin/prompts` | 管理者 | `updateAiPromptsRequestSchema`(`prompts: [{ key, body｜null, revision? }]`、本文は2万字まで)/ 同上 | null・空・既定値と同じなら上書きを消す。未知の key が含まれると 400 で何も変えない。`revision` が最新の版と違えば(他の管理者が先に保存した)409 で何も変えない(WARN `settings.ai_prompts.update_rejected`)。INFO `settings.ai_prompts.updated` |

同じ値の保存は `changed: false`「変更ありません」でログも残さない。秘密値の伏せ字: APIキーは `••••••••` + 末尾4文字(8文字以下は
全て伏せる)、Webhook URL は `…/messages?••••••••`(文字は `SECRET_MASK_CHAR`)。プロンプトの key(`AI_PROMPT_KEYS`):
`daily_report.generate`・`accident_report.generate`(kind=prompt)、`daily_report.memo_placeholder`・`accident_report.memo_placeholder`・
`accident_report.writing_hint`・`hiyari.writing_hint`(kind=placeholder)。

### 2.9 管理者 `/api/admin`

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー・ログ |
| --- | --- | --- |
| `GET /api/admin/staff` | — / `adminStaffListResponseSchema` | `{ staff: [{ id, name, kana, email, altEmail, phone, role, retiredOn, isRetired, passwordStatus, homeAddress, hasHomeGeo, travelMode, gender, scheduleCalendarId, rowVersion }] }`(退職者を含む、氏名順)。`kana` は「セイ メイ」、`scheduleCalendarId` は `staff_calendars`(purpose=schedule) |
| `POST /api/admin/staff` | `createStaffRequestSchema`(`name`・`email`・`kana?`・`altEmail?`・`phone?`・`role`(既定 staff)・`homeAddress?`・`travelMode?`(car / bicycle / transit / walk)・`gender?`(female / male / other / unknown)・`scheduleCalendarId?`・`initialPassword?`)/ `adminStaffResponseSchema` | 201 `{ staff, homeGeocode }`。初期パスワードを省くと未設定。メール・サブメールはテナント内で両方を跨いで一意(409、`fields` つき)。自宅住所はジオコーディングして緯度経度・区画を保存し、`homeGeocode` に結果(`ok` / `not_found` / `failed` / `unavailable`。住所を送らなければ null)。ok 以外でも住所は保存する。`scheduleCalendarId` はテナントの許可の一覧(運用担当者の `pnpm tenant:calendars`。05 4.2)に合うものだけで、合わなければ 400(`fields.scheduleCalendarId`「このカレンダーは使えません。運用担当者に登録を依頼してください」、WARN `staff.admin.create_rejected` `calendar_not_allowed`)。カレンダーIDは小文字にして保存する。SECURITY `staff.admin.created` |
| `PATCH /api/admin/staff/:id` | `updateStaffRequestSchema`(登録の項目 + `retiredOn`、全て省略可。null・空欄は値を消す。`rowVersion?`)/ `adminStaffResponseSchema` | `rowVersion` が今の版と違えば 409(`stale_row_version`)。`rowVersion` は地図APIを呼ぶ前に確かめる。住所を変えたとき(または住所は同じでも緯度経度が無いとき)だけジオコーディングし `homeGeocode` を返す(それ以外は null)。カレンダーを変えるときは登録と同じ許可の確かめ(400)。今日以前の退職日を入れると全セッションを失効(先の日付ならその日からログイン不可)。自分の役割の変更・退職日は 400。ほかの管理者を外す・退職させる変更は、在籍中の管理者の行をロックして確かめ、操作する人がもう管理者でなければ 403(`actor_not_admin`)、退職日の決まっていない管理者が残らなければ 409(`last_admin`)。更新する項目が無ければ 400。SECURITY `staff.admin.updated`(`changedFields` と役割・退職日・`homeGeocode`。値そのものは残さない) |
| `DELETE /api/admin/staff/:id` | — / `okResponseSchema` | 業務の記録(出勤簿・訪問・移動・勤務・日報・領収書・取込・設定の更新者 等、`ON DELETE` の無い外部キー)にも、外部キーの無い変更の履歴(`entity_changes.changed_by`・`care_record_revisions.changed_by`・`ai_prompt_revisions.created_by`)にも無ければ削除し、認証情報・ログイン用メール・セッション・再設定コード・カレンダー設定も消える。参照されていれば 409「…記録があるため削除できません。辞めた方は退職日を設定してください。」(`staff_has_records`)。自分自身は 400、無ければ 404、管理者で退職日の決まっていない管理者が残らなくなるなら 409(`last_admin`)。SECURITY `staff.admin.deleted` |
| `POST /api/admin/staff/:id/password-guide` | — / `okResponseSchema` | パスワード未設定・GAS版のパスワードのままの在籍者に、パスワード設定の案内(再設定コード。`mail.password_reset` を outbox に積み、payload は `{ purpose: 'setup_guide' }` だけ)をメールアドレス宛に送る(本文に法人ID と、ワーカーの `APP_PUBLIC_URL` があれば `?t=<法人ID>` つきのログイン画面の URL)。設定済み・退職者は 400。回数は本人の再設定の要求と同じアカウント単位の枠(メール・サブメールそれぞれ)を数え、どれかが上限なら 429(Retry-After)。SECURITY `staff.admin.password_guide_sent` |
| `GET /api/admin/audit-logs` | `auditLogQuerySchema`(`from?`・`to?`(業務日、両端を含む。既定は今日までの7日間、93日まで)・`level?`・`staffId?`(操作者か対象)・`action?`(操作コードの前方一致)・`cursor?`・`limit`(1〜200、既定50))/ `auditLogListResponseSchema` | `{ entries: [{ id, createdAt, level, action, actorType, actorStaffId, actorName, targetStaffId, targetName, details, ip, userAgent, requestId }], nextCursor, range: { from, to }, timeZone }`。新しい順(`created_at`, `id` の keyset。`nextCursor` を次の `cursor` に)。テナントの行だけ(tenant_id が null のログイン前の記録は出さない)。期間の誤り・読めない `cursor` は 400(`fields.from` / `invalid_cursor`)。最初のページだけ INFO `audit_log.viewed`(条件。スタッフを絞れば `targetStaffId`) |
| `GET /api/admin/audit-logs.csv` | 同上(`cursor`・`limit` は使わない) | `text/csv; charset=utf-8`(BOM つき、CRLF、`attachment; filename="audit-logs_<from>_<to>.csv"`)。見出し: 日時(テナントのタイムゾーン)・レベル・操作・操作コード・操作者の種類・操作者・対象スタッフ・詳細・IPアドレス・ユーザーエージェント・リクエストID。条件に合う全件を500件ずつ別のトランザクションで読んで流す。`=`・`+`・`-`・`@` で始まる値は先頭に `'` を付ける。受け取る側が切ったら読むのをやめる。途中で失敗したら(状態コードは送った後なので 200 のまま)最後の行に「※ 書き出しが途中で失敗しました(request id <X-Request-Id>)…」を書き、ERROR を残す。読み始める前に SECURITY `audit_log.exported` |
| `POST /api/admin/customers/import` | `customerCsvImportRequestSchema`(`force` 既定 true)/ `customerCsvImportResponseSchema` | `{ status, message, fileName, version, stats, dataVersion }`。`imported` / `up_to_date` / `no_files` / `not_configured` は 200、`review_required` 409、`failed` 502 |

拒否は WARN `<action>.access_denied`(`staff.admin.list` / `staff.admin.delete` / `staff.admin.password_guide` / `audit_log.view` / `audit_log.export` 等)・`staff.admin.create_rejected` / `update_rejected` / `delete_rejected` / `password_guide_rejected`(`details.reason` に理由コード)・`customer_csv.import.access_denied`。
操作コードの日本語の表示名は `@katahimo/shared` の `AUDIT_ACTION_LABELS`(画面と CSV で共有)。

### 2.10 通知 `/api/push`(`routes/push.ts`、全てログイン)

Web Push(翌日の予定のお知らせ・テスト通知。02 9.1、05 10章)。購読はログイン中の**本人の端末だけ**を扱う(要求にスタッフの
指定は無い)。`endpoint` は既知のプッシュサービス(`fcm.googleapis.com`・`android.googleapis.com`・`push.services.mozilla.com`・
`push.apple.com`・`notify.windows.com` とそのサブドメイン)の `https` の URL だけ(`isAllowedPushEndpoint`。ワーカーが任意の
URL へ送らないように)。操作ログに `endpoint`・鍵は残さない。

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー・ログ |
| --- | --- | --- |
| `GET /config` | — / `pushConfigResponseSchema` | `{ enabled, publicKey }`。VAPID の設定(`VAPID_PUBLIC_KEY`)が無ければ `{ enabled: false, publicKey: null }` |
| `POST /subscriptions` | `pushSubscribeRequestSchema`(`PushSubscription.toJSON()` の形: `endpoint`・`expirationTime?`・`keys: { p256dh, auth }`)/ `okResponseSchema` | 同じ `endpoint` があれば鍵を書き直し、別のスタッフのものなら本人に付け替える。User-Agent(300字まで)を残す。1人10件まで(超えたら `updated_at` の古いものから消す)。通知を使えない環境は 400。回数制限 `push_subscribe_staff`。INFO `push.subscription.saved`(`subscriptionId`・`created`・付け替えなら `previousStaffId`・消した数 `trimmed`) |
| `DELETE /subscriptions` | `pushUnsubscribeRequestSchema`(`endpoint`)/ `okResponseSchema` | 本人の購読だけを消す(無ければ何もしない)。INFO `push.subscription.deleted`(`subscriptionId`・`deleted`) |
| `POST /test` | — / `pushTestResponseSchema` | `{ ok, subscriptionCount }`。本人の全ての購読に送るテスト通知を購読ごとに outbox に積む。購読が無ければ 400。回数制限 `push_test_staff`。INFO `push.test.queued` |

### 2.11 外部システム連携 `/api/integrations`(`routes/integrations.ts`、API キー)

RESERVA 等の外部システムからの受け口(05 11章)。認証は `Authorization: Bearer kth_<テナントID>_<乱数>`(運用担当者が
`pnpm tenant:api-keys` で発行するテナントごとの API キー。07 3.6)だけで、**Cookie のセッションは使わない**(ログイン中の画面からは
呼べない。Cookie を自動で送られないため CSRF の前提に当たらない。1.4 の CSRF・JSON の検査はそのまま掛かる)。テナントと書ける取込元は
キーで決まり、本体では指定しない。トークンの `<テナントID>` の部分で RLS のテナントを決め、トークン全体の SHA-256 で
`integration_api_keys` を引く(平文を比べない)。キーが無い・形が違う・無い(別のテナントのIDに差し替えた場合を含む)・失効は 401、
テナントが利用停止中は 403(どちらも WARN `integration.auth_failed`、理由コードだけ)。同じ送信元IPからの失敗が続けば一時的に 429
(`integration_auth_failure_ip`。ロック中は正しいキーでも確かめず、操作ログも残さない。ロックの始まりに1回 WARN `integration.auth_locked`)。

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー・ログ |
| --- | --- | --- |
| `POST /customers` | `integrationCustomersRequestSchema`(`mode`(`upsert` だけ。既定)・`customers`(1〜500件): `externalId`・`familyName`・`givenName?`・`displayName?`(null・空は「姓 名」)・`familyNameKana?`・`givenNameKana?`・`email?`・`phone?`・`memo?`・`benefitMemberId?`・`evacuationSite?`・`home?`(`addressLine`・`prefecture?`・`city?`(省けば住所から取り出す)・`parkingArea?`・`parkingDetail?`・`lat?`・`lng?`(両方か無し))・`secondary?`(`home` と同じ + `validFrom?`・`validTo?`(両端を含む `YYYY-MM-DD`))・`emergencyContact?`(`relation?`・`phone?`)・`recipients?`(20人まで: `name`・`birthDate?`・`needs?`・`allergy?`)・`attributes?`(英小文字のキー → 値、30項目まで)・`externalRegisteredAt?`・`externalUpdatedAt?`(ISO 8601、時差つき))/ `integrationCustomersResponseSchema` | 200 `{ importRunId, counts: { created, updated, unchanged, skipped }, results: [{ externalId, outcome, issues }], dataVersion }`(`results` は送った順)。**省いた項目は今の値のまま、null は空にする**(部分的な送信でよい。新しい顧客では省いた項目は空、表示名は「姓 名」)。`home`・`secondary`・`emergencyContact` はまとまりごと、`attributes` はオブジェクトごと、`recipients` は配列ごと(渡せば全員を置き換え、配列に無い子どもはアーカイブ。`[]` で全員を外す)に置き換える(顧客CSVの1行は今の全ての値で、空の列は空にする。05 11章)。キーの取込元 × `externalId` で突き合わせ、作成・更新だけを行う(**削除・アーカイブはしない**)。全件を1トランザクションで適用し `import_runs`(`source = external_api`)を残す。同じテナントの取込(この API の同時の送信・顧客CSVの取込)とはテナントごとのロックで1つずつ適用する(待ってから適用する。同じ新しい顧客IDを同時に送っても顧客は1人)。同じ `externalId` が2回・存在しない日付・住所2の期間の逆転・緯度だけ等は 400(何も書かない)。回数制限 `integration_customers_key`。INFO `integration.customers.ingested`(`skipped`・`issues` があれば WARN)。適用に失敗したら何も残さず 500 と ERROR `integration.customers.ingest_failed` |

## 3. 本番での Web 画面の配信

`WEB_DIST_DIR` を設定すると、`/api/*` の後に静的ファイルを配信する(`http/webStatic.ts`)。拡張子の無いパスは `index.html`
(SPA)。キャッシュ: `assets/*`・`workbox-<hash>.js` は1年 immutable、`index.html`・`sw.js`・`push-sw.js`(通知の処理)・
`registerSW.js`・`manifest.webmanifest` は `no-cache`、その他は1時間。

## 4. 新しいエンドポイントを足すとき

1. `packages/shared/src/contracts/` に要求(クエリも)と応答の zod スキーマを足す(ルートの中で要求の形を定義しない)。
2. usecase(`core/usecases`)を書き、失敗は `DomainError` で投げる。権限は `requireSession` / `requireAdmin` と
   `targetStaffIdOf` で決め、usecase でも確かめる。
3. ルートは `parseJsonBody` / `parseQuery` → usecase → `jsonOk(c, 応答の契約, …)`。
4. `packages/api/src/routes.integration.test.ts` にエラーの形・権限のテストを足し、この資料の2章に行を足す。
5. 画面は `packages/web/src/api/<機能>.ts` から同じ契約で呼ぶ。
