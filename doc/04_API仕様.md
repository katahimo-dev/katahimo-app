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
- `tenantId` は**セッション Cookie からだけ**決まる。要求の本体・クエリに入れても使わない。

### 1.2 認証とセッション Cookie

| 項目 | 内容 |
| --- | --- |
| Cookie 名 | 本番 `__Host-katahimo_session`(Secure・Path=/・Domain なし)、開発 `katahimo_session` |
| 属性 | `HttpOnly`・`SameSite=Lax`・`Path=/`・本番は `Secure`。期限は無操作の期限 |
| 値 | `<テナントID>.<生トークン>`。DB は生トークンの SHA-256 だけを持つ(`sessions.token_hash`) |
| 期限 | 無操作7日(`SESSION_IDLE_TTL_MS`)。残りが6日を切った要求で7日に延ばし Cookie も更新。ログインから30日(`SESSION_ABSOLUTE_TTL_MS`)を超えない |
| 毎回の確認 | セッション(失効・期限)→ テナントが `active` → スタッフの存在 → 退職日(テナントの時刻帯の業務日)。退職済みならそのスタッフの全セッションを失効 |
| ミドルウェア | `requireSession(container, deniedAction?)`(未ログイン 401。`deniedAction` があれば WARN `<action>.access_denied`)、`requireAdmin(container, action)`(未ログイン 401・管理者以外 403、どちらも WARN) |
| 対象スタッフ | `targetStaffIdOf(c, staffId)`: 一般スタッフは常に本人、コーディネーター・管理者は指定があればそのスタッフ(usecase でも確かめる) |

### 1.3 エラー

全てのエラーは `{ code, message, fields? }`(`apiErrorSchema`)。`message` は画面にそのまま出せる日本語。

| code | HTTP | 主な場面 |
| --- | --- | --- |
| `unauthenticated` | 401 | 未ログイン・セッション切れ・ログイン失敗 |
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
| 7 | `/api/*` | 本体の上限: 既定 256KB、`POST /api/receipts` 14MB、`POST /api/receipts/ocr` 3MB(413) |

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

ログインの2つの規則は照合(argon2)の**前に**1回分の枠を取る(同時の大量の試行でも照合まで進むのは上限の回数まで)。
一致した回は数えない(アカウントは数え直し、IP は先に取った1回分を返す)。

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

`rowData` のキーは出勤簿の列記号(`C`・`D`・`E` … `AO`。意味は `sheetLayout.ts` の `ATTENDANCE_COLUMNS`)、値は文字列。
書き込みは全て INFO、失敗・拒否は WARN/ERROR、閲覧は管理者・コーディネーターが他のスタッフを見たときだけ INFO(`targetStaffId`)。

### 2.6 日報・事故報告 `/api/reports`(`routes/reports.ts`、全てログイン)

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー |
| --- | --- | --- |
| `POST /daily/generate` | `generateReportRequestSchema`(`text` 1〜20,000字・`start?`・`end?`)/ `generateDailyReportResponseSchema` | `{ draft: { warnings, internal, customer } }`。失敗もエラーにせず `warnings` に `API Error` / `API Key Missing`(GAS版と同じ)。回数制限 |
| `POST /accident/generate` | 同上 / `generateAccidentReportResponseSchema` | `{ draft: {…8項目} | { error } }`。回数制限は日報と共通 |
| `POST /daily` | `saveDailyReportRequestSchema`(`reportId?`・`rowVersion?`・`staffId?`・`customerId`・`reportDate?`・`startTime`・`endTime`・`inputText`・`internalText`・`customerText`・`riskRating?`・`esRating?`)/ `saveDailyReportResponseSchema` | `{ success, message: '保存しました', report }`(`report.rowVersion` を含む)。404 `report_not_found`、403(他人の報告。SECURITY `report.daily.save_denied`)、409 `customer_mismatch` / `author_mismatch` / 古い版、400 `locked` |
| `POST /accident` | `saveAccidentReportRequestSchema`(`reportType: '事故報告'｜'ヒヤリハット'`・`targetName`・`targetDob`・`occurrenceTime`・`location`・`accidentContent`・`situation`・`immediateResponse`・`parentCorrespondence`・`diagnosisTreatment`・`prevention`・`inputText` と上の共通項目)/ `saveAccidentReportResponseSchema` | `{ success, report }`。事故報告とヒヤリハットは上書きで切り替えられる。日報との切り替えは 404。エラーは日報と同じ |
| `POST /visit-complete` | `visitCompleteRequestSchema`(`staffId?`・`customerId`・`visitDate`・`startTime`・`endTime`)/ `visitCompleteResponseSchema` | `{ success: true }`。DB に書かず Google Chat に知らせるだけ |
| `GET /history?customerId=&before?` | `customerHistoryQuerySchema` / `customerHistoryResponseSchema` | `{ items, nextCursor }`(5件ずつ、`(occurred_at DESC, id DESC)` のキーセット。続きが無ければ `null`)。読めない `before` は 400 |

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
| `GET /api/settings/admin/prompts` | 管理者 | — / `aiPromptListResponseSchema` | `{ prompts: [{ key, kind, label, body, defaultBody, customized, updatedAt }] }` |
| `PUT /api/settings/admin/prompts` | 管理者 | `updateAiPromptsRequestSchema`(`prompts: [{ key, body｜null }]`)/ 同上 | null・空・既定値と同じなら上書きを消す。未知の key が含まれると 400 で何も変えない。INFO `settings.ai_prompts.updated` |

同じ値の保存は `changed: false`「変更ありません」でログも残さない。秘密値の伏せ字: APIキーは `••••••••` + 末尾4文字(8文字以下は
全て伏せる)、Webhook URL は `…/messages?••••••••`(文字は `SECRET_MASK_CHAR`)。プロンプトの key(`AI_PROMPT_KEYS`):
`daily_report.generate`・`accident_report.generate`(kind=prompt)、`daily_report.memo_placeholder`・`accident_report.memo_placeholder`・
`accident_report.writing_hint`・`hiyari.writing_hint`(kind=placeholder)。

### 2.9 管理者 `/api/admin`

| メソッド・パス | 契約(要求 / 応答) | 応答・エラー・ログ |
| --- | --- | --- |
| `GET /api/admin/staff` | — / `adminStaffListResponseSchema` | `{ staff: [{ id, name, email, altEmail, phone, role, retiredOn, isRetired, passwordStatus }] }`(退職者を含む) |
| `POST /api/admin/staff` | `createStaffRequestSchema`(`name`・`email`・`altEmail?`・`phone?`・`role`(既定 staff)・`initialPassword?`)/ `adminStaffResponseSchema` | 201 `{ staff }`。初期パスワードを省くと未設定(本人が再設定で決める)。メール・サブメールはテナント内で両方を跨いで一意(409)。SECURITY `staff.admin.created` |
| `PATCH /api/admin/staff/:id` | `updateStaffRequestSchema`(各項目を省略可、`altEmail`・`phone`・`retiredOn` は null で消す)/ `adminStaffResponseSchema` | 退職日を入れると全セッションを失効。自分の管理者権限の解除・退職日は 400。SECURITY `staff.admin.updated` |
| `POST /api/admin/customers/import` | `customerCsvImportRequestSchema`(`force` 既定 true)/ `customerCsvImportResponseSchema` | `{ status, message, fileName, version, stats, dataVersion }`。`imported` / `up_to_date` / `no_files` / `not_configured` は 200、`review_required` 409、`failed` 502 |

拒否は WARN `<action>.access_denied`(`staff.admin.list` 等)・`staff.admin.create_rejected` / `update_rejected`・`customer_csv.import.access_denied`。

## 3. 本番での Web 画面の配信

`WEB_DIST_DIR` を設定すると、`/api/*` の後に静的ファイルを配信する(`http/webStatic.ts`)。拡張子の無いパスは `index.html`
(SPA)。キャッシュ: `assets/*`・`workbox-<hash>.js` は1年 immutable、`index.html`・`sw.js`・`registerSW.js`・`manifest.webmanifest`
は `no-cache`、その他は1時間。

## 4. 新しいエンドポイントを足すとき

1. `packages/shared/src/contracts/` に要求(クエリも)と応答の zod スキーマを足す(ルートの中で要求の形を定義しない)。
2. usecase(`core/usecases`)を書き、失敗は `DomainError` で投げる。権限は `requireSession` / `requireAdmin` と
   `targetStaffIdOf` で決め、usecase でも確かめる。
3. ルートは `parseJsonBody` / `parseQuery` → usecase → `jsonOk(c, 応答の契約, …)`。
4. `packages/api/src/routes.integration.test.ts` にエラーの形・権限のテストを足し、この資料の2章に行を足す。
5. 画面は `packages/web/src/api/<機能>.ts` から同じ契約で呼ぶ。見比べのモック(`tools/gas-preview/src/webMock.ts`)にも足す。
