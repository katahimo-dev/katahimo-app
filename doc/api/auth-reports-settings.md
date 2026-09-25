# API仕様: 認証・日報/事故報告・領収書・設定・スタッフ管理

GAS版 `gas-childcare-visit-app` の `Auth.js` / `Main.js` / `GeminiReport.js` / `GoogleChat.js` の機能を移植したAPI。
リクエスト/レスポンスのzodスキーマは `packages/shared/src/contracts/` にあり(下表の「契約」列)、UIはこれを直接importして使う。

## 共通事項

- **認証**: ログイン成功時に httpOnly Cookie `katahimo_session`(値は `テナントID.生トークン`)を発行する。以後のAPIはCookieだけで本人を特定し、リクエストに含まれる `tenantId` は一切使わない。`staffId` は管理者の場合のみ有効(CLAUDE.md の admin-vs-self パターン)。
- **セッション**: 有効期間7日。残りが6日を切ったリクエストで7日に延長し、Cookieの期限も更新する(GAS版 `checkSession` のローリング延長)。退職日は毎リクエスト確認し、退職済みならそのスタッフの全セッションを削除する。
- **退職日の判定**: `retirement_date`(JSTの日付)の当日以降はログイン不可。JSTの日付文字列同士で比較する。
- **エラー形式**: 失敗時は `{ code, message, fields? }`(`apiErrorSchema`)をHTTPステータスとともに返す。`code` は `unauthenticated`(401) / `forbidden`(403) / `not_found`(404) / `validation_failed`(400) / `conflict`(409)。
- **ログ**: 全て `app_logs` に記録する(GAS版 `logToBuffer` の規約どおり。WARN/ERROR/SECURITYは常に記録、読み取り成功は管理者の機密閲覧など必要なものだけ)。details に個人情報・本文は入れない(ログインIDはマスクして記録)。

## 認証 `/api/auth`

| メソッド・パス | 権限 | リクエスト | レスポンス | 契約 | 主なログ |
| --- | --- | --- | --- | --- | --- |
| `POST /login` | 誰でも | `{tenantSlug, email, password}`。`email` はメール・サブメール(`alt_email`)のどちらでもよい | `{staff: {staffId, tenantId, name, email, isAdmin}}` + Cookie。失敗は401「メールアドレスまたはパスワードが違います」、退職済み(パスワード一致後に判定)は401「ログイン権限のないユーザーです」 | `loginRequestSchema` / `sessionUserResponseSchema` | 成功 INFO `auth.login.succeeded`、失敗 SECURITY `auth.login.failed`(テナント不明時は tenant_id=null) |
| `GET /me` | ログイン中 | - | `{staff}`。無効なら401 | `sessionUserResponseSchema` | ページ読込扱いで INFO `auth.session.auto_login` / WARN `auth.session.auto_login_failed` |
| `POST /logout` | 誰でも | - | `{ok: true}`。セッション行を削除しCookieを消す | - | INFO `auth.logout` |
| `POST /change-password` | ログイン中 | `{currentPassword, newPassword}`(8〜128文字) | `{success: true, message}`。操作中以外のセッションは失効 | `changePasswordRequestSchema` / `changePasswordResponseSchema` | SECURITY `auth.password_change.succeeded` / `.failed`、未ログイン WARN `auth.password_change.access_denied` |
| `POST /password-reset/request` | 誰でも | `{tenantSlug, email}` | 常に `{ok: true, message}`(アカウントの有無・送信成否を伝えない) | `passwordResetRequestSchema` / `passwordResetRequestResponseSchema` | 発行 SECURITY `auth.password_reset.requested`、拒否 WARN `.request_rejected`(未登録/退職/発行回数超過)、送信失敗 ERROR `.mail_failed` |
| `POST /password-reset/confirm` | 誰でも | `{tenantSlug, email, code(6桁), newPassword}` | `{ok: true, message: 'パスワードを再設定しました'}`。失敗は400「無効な認証コードです」/「認証コードの有効期限が切れています」/入力回数超過 | `passwordResetConfirmSchema` / `passwordResetConfirmResponseSchema` | 完了 SECURITY `auth.password_reset.completed`、失敗 WARN `.failed` |

パスワード再設定の規則:

- コードは6桁の数字、有効期限30分、1回限り。DBには `HMAC-SHA256(SESSION_SECRET, staffId:code)` だけを保存する。
- 送信先はGAS版と同じく、サブメールで要求した場合はサブメール宛、それ以外はメール宛(台帳の値のみを使う)。文面はGAS版と同じ(件名「【保育日報】パスワード再設定認証コード」)。
- 新しいコードを発行すると古いコードは無効。誤入力5回でコード無効。1スタッフあたり1時間に5回まで発行。
- 再設定に成功するとそのスタッフの全セッションを失効させる。
- メール送信は `SMTP_HOST/PORT/USER/PASS/FROM` 設定時はSMTP、未設定時(開発)は標準出力に本文を出すだけ(本番ではSMTP設定が必須で、未設定なら起動時エラー)。

## 日報・事故報告 `/api/reports`

| メソッド・パス | 権限 | リクエスト | レスポンス | 契約 |
| --- | --- | --- | --- | --- |
| `POST /daily` | ログイン中 | `{reportId?, staffId?, customerId, reportDate?, startTime, endTime, inputText, internalText, customerText, riskRating?, esRating?}` | `{success: true, message, report}` | `saveDailyReportRequestSchema` / `saveDailyReportResponseSchema` |
| `POST /accident` | ログイン中 | `{reportId?, staffId?, customerId, reportType('事故報告'/'ヒヤリハット'), targetName, …, inputText}` | `{success: true, report}` | `saveAccidentReportRequestSchema` / `saveAccidentReportResponseSchema` |
| `POST /daily/generate`・`/accident/generate` | ログイン中 | `{text, start?, end?}` | `{draft}`。プロンプトはテナントの編集版(無ければ既定) | - |
| `POST /visit-complete` | ログイン中 | `{staffId?, customerId, visitDate, startTime, endTime}` | `{success: true}` | - |
| `GET /history?customerId=&before=` | ログイン中 | - | `{items}`(5件) | - |

- 担当スタッフ: 管理者以外は常に本人(`staffId` は無視)。管理者は `staffId` 指定 → 上書き対象の元の担当者 → 本人 の順。
- **上書き(`reportId`)の権限**: 管理者以外は自分の報告しか上書きできない(403、SECURITY `report.<daily|accident>.save_denied`)。GAS版は行番号さえ分かれば他人の日報を上書きできた穴を塞いだ。存在しない `reportId` は404。`reportId` の報告が送られた `customerId` のお客様のものでなければ409 `conflict`(WARN `report.<daily|accident>.save_denied` reason `customer_mismatch`。別のお客様の日報を開き直したあとに前の保存が届いた場合などに、前のお客様の報告を書きかえないため)。
- 保存成功で INFO `report.<daily|accident>.saved`(管理者が他スタッフ名義で保存した場合は target_staff_id に担当者)。
- Google Chat通知の未設定は WARN `notification.gchat.not_configured`、送信失敗は ERROR `notification.gchat.failed`(保存自体は成功扱い)。

## 領収書 `/api/receipts`

| メソッド・パス | 権限 | リクエスト | レスポンス | 契約 |
| --- | --- | --- | --- | --- |
| `POST /` | ログイン中 | `{staffId?, customerId?\|null, customerNameText?, images: [{data, amount?, storeName?, receiptDate?}], receiptTimestamp?, reportDate?, startTime?, handoffText?}` | `{success: true, message, uploadedCount, duplicateCount, duplicates, uploadBatchId}` | `uploadReceiptsRequestSchema` / `uploadReceiptsResponseSchema` |
| `POST /ocr` | ログイン中 | `{image}` | `{result: {amount, storeName, receiptDate, error?}}` | - |

- `customerId` を省略/nullにすると「お客様の指定なし」の領収書(GAS版 `openStandaloneReceiptModal`)。`customerNameText` に未登録のお客様の氏名を保存し、通知の「顧客名:」にも使う。
- 画像ごとの日時が無い場合のフォールバック: `receiptTimestamp` → `reportDate`+`startTime`(秒は00、GAS版 `buildReceiptTimestamp`)→ 登録時刻。
- 1回の操作で登録した行は同じ `upload_batch_id` を持ち、申し送りは最初に登録した行にだけ保存する。重複判定(スタッフ・顧客・日時・金額・店舗名)はGAS版と同じ。
- ミラー(Bridge.js `writeReceipt`)のペイロードに `receiptId`・`uploadBatchId` を追加し、`customerName` は未登録のお客様なら入力された氏名を送る(既存項目は互換)。
- ログ: INFO `receipt.uploaded`(件数・バッチID)。

## UI設定 `/api/ui-config`

| メソッド・パス | 権限 | レスポンス | 契約 |
| --- | --- | --- | --- |
| `GET /api/ui-config` | ログイン中 | `{dailyPlaceholder, accidentPlaceholder, accidentHint, hiyariPlaceholder, assessments}`(GAS版 `getUiConfig` と同じ項目名) | `uiConfigResponseSchema` |

文言は `ai_prompts`(kind=placeholder)にテナントの上書きがあればその値、無ければ `packages/shared/src/defaults/aiPrompts.ts` の既定値(GAS版 `DEFAULT_PROMPTS` と同文)。評価定義は `defaults/assessments.ts`。

## 管理者設定 `/api/settings/admin`(全て管理者のみ)

管理者以外は403、未ログインは401で、どちらも WARN `<action>.access_denied` を記録する(GAS版 `logAdminAccessDenied_`)。

| メソッド・パス | リクエスト | レスポンス | 契約 | ログ |
| --- | --- | --- | --- | --- |
| `GET /` | - | `{settings: {geminiApiKey, geminiReportModel, geminiOcrModel, gchatReportWebhookUrl, gchatReceiptWebhookUrl}}`(復号済み) | `adminSettingsResponseSchema` | SECURITY `settings.secrets.viewed` |
| `POST /gemini-key` | `{apiKey}` | `{ok: true, changed, message}`。空は400 | `saveGeminiApiKeyRequestSchema` / `saveSettingsResponseSchema` | 変更 SECURITY `settings.gemini_api_key.changed`、空 WARN `.save_rejected` |
| `POST /gemini-models` | `{reportModel, ocrModel}` | 同上 | `saveGeminiModelsRequestSchema` | SECURITY `settings.gemini_models.changed` |
| `POST /gchat-webhooks` | `{reportWebhookUrl, receiptWebhookUrl}` | 同上 | `saveGchatWebhooksRequestSchema` | SECURITY `settings.gchat_webhooks.changed` |
| `POST /gemini-models/available` | `{apiKey?}`(空なら保存済みのキー) | `{success: true, models}`。キー無し400、API失敗502 | `listGeminiModelsRequestSchema` / `listGeminiModelsResponseSchema` | INFO `.listed` / ERROR `.list_failed` |
| `GET /prompts` | - | `{prompts: [{key, kind, label, body, defaultBody, customized, updatedAt}]}` | `aiPromptListResponseSchema` | - |
| `PUT /prompts` | `{prompts: [{key, body\|null}]}`。null/空/既定値と同文なら上書きを削除 | `{prompts}`。未知のkeyが含まれると400で何も変更しない | `updateAiPromptsRequestSchema` | INFO `settings.ai_prompts.updated` |

同じ値での保存は「変更ありません」(`changed: false`)を返し、ログも残さない(GAS版と同じ)。

プロンプトのkey(`AI_PROMPT_KEYS`): `daily_report.generate`・`accident_report.generate`(kind=prompt、`{anonymizedText}`/`{timeInfo}`を含む)、`daily_report.memo_placeholder`・`accident_report.memo_placeholder`・`accident_report.writing_hint`・`hiyari.writing_hint`(kind=placeholder)。GAS版シートのKey列との対応は `legacySheetKey`。

## スタッフ管理 `/api/admin/staff`(全て管理者のみ)

| メソッド・パス | リクエスト | レスポンス | 契約 | ログ |
| --- | --- | --- | --- | --- |
| `GET /` | - | `{staff: [{id, name, email, altEmail, phone, isAdmin, retirementDate, isRetired, passwordStatus}]}`(退職者を含む) | `adminStaffListResponseSchema` | - |
| `POST /` | `{name, email, altEmail?, phone?, isAdmin, initialPassword?}`。初期パスワード省略時は未設定(本人がパスワード再設定で設定) | 201 `{staff}` | `createStaffRequestSchema` / `adminStaffResponseSchema` | SECURITY `staff.admin.created` |
| `PATCH /:id` | `{name?, email?, altEmail?, phone?, isAdmin?, retirementDate?}`(nullで削除) | `{staff}` | `updateStaffRequestSchema` / `adminStaffResponseSchema` | SECURITY `staff.admin.updated`(変更した項目名) |

- email/altEmailはテナント内で両列を跨いで一意(409 `conflict`、`fields` に項目名)。
- 自分自身の管理者権限の解除・退職日設定は400(管理者不在の事故防止)。
- 拒否は WARN `staff.admin.create_rejected` / `staff.admin.update_rejected`。

### スタッフ台帳の一括取込(運用スクリプト)

```bash
pnpm --filter @katahimo/api import:staff-master -- <tenantSlug> <CSVファイル> [--dry-run]
```

GAS版スタッフ台帳(Staffシート)をCSV(UTF-8)で書き出したものを取り込む。列はGAS版 `Auth.js` と同じ位置で読む(B=氏名、E=メール、H=退職日、J=パスワード、K=管理者フラグ(1)、M=サブメール('@'を含む場合のみ))。メールで照合して既存は更新・無ければ作成。J列が64桁hexならGAS版ハッシュとして移行(初回ログイン時にargon2idへ自動移行、`LEGACY_AUTH_SALT` が必要)、それ以外の値は平文パスワードとみなしてargon2idで保存。本アプリでパスワード設定済みのスタッフのパスワードは上書きしない。

## 顧客 `/api/customers/:id`(変更点)

世帯構成員に `allergy`(復号済み、無ければnull=UIは「アレルギー: なし」)を追加した(`customerDetailResponseSchema`)。GAS版は取込時にアレルギー列を常に空にし、シートの手入力でだけ表示していたため、本アプリではRESERVAの「世帯全員の情報」欄に明示的に書かれた記述(「アレルギーなし」「アレルギー:卵」「卵アレルギー」等)を `extractAllergy` で保守的に抽出して保存する(info欄は加工せず残す)。
