# API仕様: 認証・日報/事故報告・領収書・設定・スタッフ管理

GAS版 `gas-childcare-visit-app` の `Auth.js` / `Main.js` / `GeminiReport.js` / `GoogleChat.js` の機能を移植したAPI。
リクエスト/レスポンスのzodスキーマは `packages/shared/src/contracts/` にあり(下表の「契約」列)、UIはこれを直接importして使う。

## 共通事項

- **認証**: ログイン成功時に httpOnly Cookie `katahimo_session`(本番は `__Host-katahimo_session`。値は `テナントID.生トークン`)を発行する。以後のAPIはCookieだけで本人を特定し、リクエストに含まれる `tenantId` は一切使わない。`staffId` は管理者の場合のみ有効(CLAUDE.md の admin-vs-self パターン)。
- **セッション**: 有効期間7日。残りが6日を切ったリクエストで7日に延長し、Cookieの期限も更新する(GAS版 `checkSession` のローリング延長)。ただしログインから30日を過ぎたセッションは延長していても無効(絶対的な有効期間。延長後の期限も30日を超えない)。退職日は毎リクエスト確認し、退職済みならそのスタッフの全セッションを削除する。テナントが停止中(`tenants.status='suspended'`)ならログイン・既存セッション・パスワード再設定をすべて拒否する(セッション行は残し、再開すればそのまま使える)。
- **退職日の判定**: `retirement_date`(JSTの日付)の当日以降はログイン不可。JSTの日付文字列同士で比較する。
- **エラー形式**: 失敗時は `{ code, message, fields? }`(`apiErrorSchema`)をHTTPステータスとともに返す。`code` は `unauthenticated`(401) / `forbidden`(403) / `not_found`(404) / `validation_failed`(400・413・415) / `conflict`(409) / `rate_limited`(429、`Retry-After` ヘッダーに再試行までの秒数)。
- **セキュリティの共通処理**(`packages/api/src/http/security.ts`、「セキュリティの共通処理」節): CSRF対策・Content-Type の検査・本体の大きさの上限・セキュリティヘッダー・`/api/*` の `Cache-Control: no-store`。
- **ログ**: 全て `app_logs` に記録する(GAS版 `logToBuffer` の規約どおり。WARN/ERROR/SECURITYは常に記録、読み取り成功は管理者の機密閲覧など必要なものだけ)。details に個人情報・本文は入れない(ログインIDはマスクして記録)。

## 認証 `/api/auth`

| メソッド・パス | 権限 | リクエスト | レスポンス | 契約 | 主なログ |
| --- | --- | --- | --- | --- | --- |
| `POST /login` | 誰でも | `{tenantSlug, email, password}`。`email` はメール・サブメール(`alt_email`)のどちらでもよい | `{staff: {staffId, tenantId, name, email, isAdmin}}` + Cookie。失敗は401「メールアドレスまたはパスワードが違います」、退職済み(パスワード一致後に判定)は401「ログイン権限のないユーザーです」、テナント停止中(同)は401「ご利用の法人は現在利用を停止しています。…」、失敗が続いてロック中は429 | `loginRequestSchema` / `sessionUserResponseSchema` | 成功 INFO `auth.login.succeeded`、失敗 SECURITY `auth.login.failed`(テナント不明時は tenant_id=null)、ロック開始 SECURITY `auth.login.lockout_started`、ロック中の試行 SECURITY `auth.login.locked` |
| `GET /me` | ログイン中 | - | `{staff}`。無効なら401 | `sessionUserResponseSchema` | ページ読込扱いで INFO `auth.session.auto_login` / WARN `auth.session.auto_login_failed` |
| `POST /logout` | 誰でも | - | `{ok: true}`。セッション行を削除しCookieを消す | - | INFO `auth.logout` |
| `POST /change-password` | ログイン中 | `{currentPassword, newPassword}`(8〜128文字) | `{success: true, message}`。操作中以外のセッションは失効 | `changePasswordRequestSchema` / `changePasswordResponseSchema` | SECURITY `auth.password_change.succeeded` / `.failed`、未ログイン WARN `auth.password_change.access_denied` |
| `POST /password-reset/request` | 誰でも | `{tenantSlug, email}` | 常に `{ok: true, message}`(アカウントの有無・送信成否を伝えない)。送信元IP単位の上限超過だけ429 | `passwordResetRequestSchema` / `passwordResetRequestResponseSchema` | 発行 SECURITY `auth.password_reset.requested`、拒否 WARN `.request_rejected`(未登録/退職/テナント停止/回数超過)。送信の最終的な失敗はワーカーの ERROR `mirror.job_failed`(kind=`password_reset_mail`) |
| `POST /password-reset/confirm` | 誰でも | `{tenantSlug, email, code(6桁), newPassword}` | `{ok: true, message: 'パスワードを再設定しました'}`。失敗は400「無効な認証コードです」/「認証コードの有効期限が切れています」/入力回数超過、回数制限は429 | `passwordResetConfirmSchema` / `passwordResetConfirmResponseSchema` | 完了 SECURITY `auth.password_reset.completed`、失敗 WARN `.failed` |

パスワード再設定の規則:

- コードは6桁の数字(GAS版と同じ。スタッフの入力のしやすさを優先し、桁数は増やさず回数制限で守る)、有効期限30分、1回限り。照合用にはDBに `HMAC-SHA256(鍵, staffId:code)` だけを保存する。鍵は `SESSION_SECRET` から HKDF-SHA256(info=`katahimo/password-reset-code/v1`)で導出した専用の値(`SESSION_SECRET` そのものを使い回さない)。
- 1つのコードに対する入力は正しいコードも含めて5回まで。試行回数の加算と上限判定は照合より前に1文の条件付き更新(`UPDATE … SET attempt_count = attempt_count + 1 WHERE id = $1 AND used_at IS NULL AND attempt_count < 5 AND expires_at > now() RETURNING *`)で行い、行が返らなければ照合しない。使用済みへの遷移も `UPDATE … SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING` で1行を得たときだけ成功とする。並列に大量の確認を送っても上限を超えて試せず、同じコードで2回再設定もできない(2026-09 のレビューで、41件の並列送信で試行回数40・正しいコードが通ることを確認して修正。`packages/db/src/integration` の実DBテストで再発を確かめる)。
- 送信先はGAS版と同じく、サブメールで要求した場合はサブメール宛、それ以外はメール宛(台帳の値のみを使う)。文面はGAS版と同じ(件名「【保育日報】パスワード再設定認証コード」)。
- 新しいコードを発行すると古いコードは無効。発行要求はアカウント単位(入力されたテナント+ログインID。存在しないアカウントも同じく数える)で1時間5回、送信元IP単位で1時間20回まで。上限を超えた要求では既存のコードに触れない(第三者が有効なコードを無効にし続けられない)。確認はアカウント単位で1時間20回、送信元IP単位で1時間50回まで。
- 再設定に成功するとそのスタッフの全セッションを失効させる。
- **メールはワーカーが送る**: APIは送信待ちのコード(`password_reset_codes.mail_code_ciphertext`、CryptoPortで暗号化)を保存して outbox に `password_reset_mail` ジョブを積むだけで、SMTPの所要時間が応答時間に表れない(アカウントの有無を応答時間から推測されない。Cloud Run の API は応答後にCPUが絞られるため、応答後の送信ではなく outbox にした)。ワーカーは復号して送信し、送信後・使用後・期限切れで送信待ちのコードを消す。失敗は outbox の再試行に任せる。ワーカーの `SMTP_HOST/PORT/USER/PASS/FROM` 設定時はSMTP、未設定時(開発)は標準出力に本文を出すだけ(本番ではワーカーのSMTP設定が必須で、未設定なら起動時エラー)。開発で再設定を試すときは `pnpm worker`(または `pnpm --filter @katahimo/worker outbox:once`)を動かす。
- 存在しないテナント・アカウント・パスワード未設定のスタッフへのログインでも、ダミーのargon2照合を行って応答時間をそろえる。

### 総当たり・使いすぎの対策(レート制限)

回数は `rate_limit_buckets`(Postgres。Cloud Run の複数インスタンスで共有)に固定窓で数える。キーはサーバー側の鍵(`SESSION_SECRET` から HKDF で導出)付きハッシュにして保存し、IPアドレス・ログインIDを平文で残さない。

| 規則 | キー | 既定 | 超えたとき | 回数の環境変数 |
| --- | --- | --- | --- | --- |
| ログイン失敗(アカウント) | テナントslug+ログインID(正規化後。存在しないアカウントも同じく数える) | 15分に10回 → 15分ロック | 429(正しいパスワードでも)。成功で失敗回数を戻す | `RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT` |
| ログイン失敗(送信元IP) | IP | 15分に50回 → 15分ロック | 429 | `RATE_LIMIT_LOGIN_FAILURES_PER_IP` |
| 再設定の発行要求 | アカウント / IP | 1時間に5回 / 20回 | アカウント: 何もせず同じ応答 / IP: 429 | `RATE_LIMIT_PASSWORD_RESET_REQUESTS_PER_ACCOUNT` / `_PER_IP` |
| 再設定の確認 | アカウント / IP | 1時間に20回 / 50回 | 429 | - |
| AI生成(日報・事故報告) | スタッフ | 1日200回 | 429「本日のAI生成の利用回数の上限に達しました…」 | `RATE_LIMIT_AI_GENERATE_PER_STAFF_DAY` |
| 領収書OCR | スタッフ | 1日300回 | 429(手入力を案内) | `RATE_LIMIT_RECEIPT_OCR_PER_STAFF_DAY` |
| 予定のルート再計算(`forceRefresh=1`) | スタッフ | 1時間30回 | 429 | `RATE_LIMIT_SCHEDULE_REFRESH_PER_STAFF_HOUR` |

上限を超えた記録は WARN `rate_limit.exceeded`(規則名・回数)に残る(ログインのロックは上記の SECURITY)。古い行はアダプタが時々まとめて削除する。

### 送信元IPの判定

アプリログ・IP単位の制限に使う送信元IPは `X-Forwarded-For` の**右から** `TRUSTED_PROXY_HOPS` 番目(未指定は本番1・それ以外0)。プロキシは受け取った値の末尾に接続元を付け足すため、利用者が偽装して送った値は左側に並ぶ。Cloud Run に直接届く構成では Google Front End が付けた末尾の値が実際の接続元(1)。外部HTTPSロードバランサ(Cloud Armor 等)を前に置く場合は末尾にLBのIPが加わるため2にする。0なら `X-Forwarded-For` を使わず接続元のアドレスを使う(開発)。

## 日報・事故報告 `/api/reports`

| メソッド・パス | 権限 | リクエスト | レスポンス | 契約 |
| --- | --- | --- | --- | --- |
| `POST /daily` | ログイン中 | `{reportId?, staffId?, customerId, reportDate?, startTime, endTime, inputText, internalText, customerText, riskRating?, esRating?}` | `{success: true, message, report}` | `saveDailyReportRequestSchema` / `saveDailyReportResponseSchema` |
| `POST /accident` | ログイン中 | `{reportId?, staffId?, customerId, reportType('事故報告'/'ヒヤリハット'), targetName, …, inputText}` | `{success: true, report}` | `saveAccidentReportRequestSchema` / `saveAccidentReportResponseSchema` |
| `POST /daily/generate`・`/accident/generate` | ログイン中 | `{text, start?, end?}` | `{draft}`。プロンプトはテナントの編集版(無ければ既定) | - |
| `POST /visit-complete` | ログイン中 | `{staffId?, customerId, visitDate, startTime, endTime}` | `{success: true}` | - |
| `GET /history?customerId=&before=` | ログイン中 | - | `{items}`(5件) | - |

- 担当スタッフ: 管理者以外は常に本人(`staffId` は無視)。管理者は `staffId` 指定 → 上書き対象の元の担当者 → 本人 の順。
- **上書き(`reportId`)の権限**: 管理者以外は自分の報告しか上書きできない(403、SECURITY `report.<daily|accident>.save_denied`)。GAS版は行番号さえ分かれば他人の日報を上書きできた穴を塞いだ。存在しない `reportId` は404。
- 保存成功で INFO `report.<daily|accident>.saved`(管理者が他スタッフ名義で保存した場合は target_staff_id に担当者)。
- Google Chat通知の未設定は WARN `notification.gchat.not_configured`、送信失敗は ERROR `notification.gchat.failed`(保存自体は成功扱い)。

## 領収書 `/api/receipts`

| メソッド・パス | 権限 | リクエスト | レスポンス | 契約 |
| --- | --- | --- | --- | --- |
| `POST /` | ログイン中 | `{staffId?, customerId?\|null, customerNameText?, images: [{data, amount?, storeName?, receiptDate?}], receiptTimestamp?, reportDate?, startTime?, handoffText?}` | `{success: true, message, uploadedCount, duplicateCount, duplicates, uploadBatchId}` | `uploadReceiptsRequestSchema` / `uploadReceiptsResponseSchema` |
| `POST /ocr` | ログイン中 | `{image}` | `{result: {amount, storeName, receiptDate, error?}}`。スタッフ単位の1日の上限超過は429 | `receiptOcrRequestSchema` / `receiptOcrResponseSchema` |

- **画像の検証**: 1回の登録は6枚まで(GAS版と同じ)、1枚1.5MB(復号後)まで、要求本体は14MB(OCRは3MB)まで。種類は data URL の申告ではなく中身の先頭バイトで判定し、JPEG・PNG・WebP だけを受け付ける(画面は1200px・JPEG品質0.7に縮めてから送るため通常は数百KB。HEIC は画面側でJPEGに変換されるため受け付けない)。保存する Content-Type と拡張子(`.jpg`/`.png`/`.webp`)は判定した種類に合わせる。1枚でも不正なら何も保存せず400(`fields` に `images.<番号>.data`)。

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
| `GET /` | - | `{settings: {geminiApiKey, geminiApiKeySet, geminiReportModel, geminiOcrModel, gchatReportWebhookUrl, gchatReportWebhookUrlSet, gchatReceiptWebhookUrl, gchatReceiptWebhookUrlSet}}`。APIキー・Webhook URLは**伏せ字**(下記)と設定済みフラグだけ | `adminSettingsResponseSchema` | - |
| `POST /gemini-key` | `{apiKey}` | `{ok: true, changed, message}`。空は400。今の伏せ字のままなら変更なし、伏せ字の一部だけ書き換えた値は400 | `saveGeminiApiKeyRequestSchema` / `saveSettingsResponseSchema` | 変更 SECURITY `settings.gemini_api_key.changed`、空・一部書き換え WARN `.save_rejected` |
| `POST /gemini-models` | `{reportModel, ocrModel}` | 同上 | `saveGeminiModelsRequestSchema` | SECURITY `settings.gemini_models.changed` |
| `POST /gchat-webhooks` | `{reportWebhookUrl?, receiptWebhookUrl?}`(省略・今の伏せ字のままの項目は保存済みの値のまま)。新しい値は `https://chat.googleapis.com/v1/spaces/<space>/messages?...` だけ(それ以外は400) | 同上 | `saveGchatWebhooksRequestSchema` | SECURITY `settings.gchat_webhooks.changed`、拒否 WARN `.save_rejected`(empty / invalid_url / partially_masked) |
| `POST /gemini-models/available` | `{apiKey?}`(空・伏せ字のままなら保存済みのキー) | `{success: true, models}`。キー無し400、API失敗502 | `listGeminiModelsRequestSchema` / `listGeminiModelsResponseSchema` | INFO `.listed` / ERROR `.list_failed` |
| `GET /prompts` | - | `{prompts: [{key, kind, label, body, defaultBody, customized, updatedAt}]}` | `aiPromptListResponseSchema` | - |
| `PUT /prompts` | `{prompts: [{key, body\|null}]}`。null/空/既定値と同文なら上書きを削除 | `{prompts}`。未知のkeyが含まれると400で何も変更しない | `updateAiPromptsRequestSchema` | INFO `settings.ai_prompts.updated` |

同じ値での保存は「変更ありません」(`changed: false`)を返し、ログも残さない(GAS版と同じ)。

**秘密値の伏せ字**(GAS版との意図した違い): GAS版は保存済みのAPIキー・Webhook URLを平文で画面に返していたが、画面から漏れても使えないよう、APIキーは `••••••••` + 末尾4文字(8文字以下は全て伏せる)、Webhook URLは `https://chat.googleapis.com/v1/spaces/<space>/messages?••••••••`(key/token のクエリを伏せる)で返す。伏せ字の文字は `SECRET_MASK_CHAR`(`•`)。画面の入力欄は従来どおりパスワード欄+「表示/隠す」だが、「表示」で見えるのは伏せ字。伏せ字の欄にフォーカスすると全体が選択され、入力で丸ごと置き換わる。

**Webhookの送信**(SSRF対策): 送信時にも送信先が Google Chat の Webhook URL か確かめ(`.env` の `GCHAT_*_WEBHOOK_URL` も同じ)、リダイレクトは追わず(3xxは失敗)、10秒で打ち切る。失敗の記録(ERROR `notification.gchat.failed`)には HTTP ステータスと理由コード(`http_error` / `timeout` / `network_error` / `invalid_webhook_url`)だけを残し、応答本文は残さない。

**外部APIの鍵**: Gemini API の鍵はURLのクエリ(`?key=`)ではなく `x-goog-api-key` ヘッダーで送る(プロキシ・アクセスログに残さないため)。モデル名はURLエンコードする。モデル一覧の取得失敗のエラーには応答本文を含めない。

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

顧客の詳細(要配慮情報を含む)を開くと INFO `customer.detail.viewed`(`details.customerId`)を記録する(GAS版には無い閲覧の監査ログ。件数は少ない)。閲覧できる顧客を担当分だけに絞るかは運用で決める事項で、現状はGAS版と同じく全スタッフが全顧客を閲覧できる。

世帯構成員に `allergy`(復号済み、無ければnull=UIは「アレルギー: なし」)を追加した(`customerDetailResponseSchema`)。GAS版は取込時にアレルギー列を常に空にし、シートの手入力でだけ表示していたため、本アプリではRESERVAの「世帯全員の情報」欄に明示的に書かれた記述(「アレルギーなし」「アレルギー:卵」「卵アレルギー」等)を `extractAllergy` で保守的に抽出して保存する(info欄は加工せず残す)。

## セキュリティの共通処理(`packages/api/src/http/security.ts`)

- **CSRF**: 状態を変える要求(POST/PUT/PATCH/DELETE の `/api/*`)は、`Sec-Fetch-Site` が `same-origin` / `none` 以外なら403。`Sec-Fetch-Site` の無い古いブラウザは `Origin` のホストが `Host` と違えば403。どちらも無い要求(curl 等のブラウザ以外)は通す。Cookie は `SameSite=Lax`・httpOnly、本番は `__Host-` 接頭辞(Secure・Path=/・Domainなし)。開発の Vite プロキシ(Host が書き換わる)でもブラウザから見て同一オリジンのため通る。
- **Content-Type**: 本体のある状態変更の要求は `application/json` だけ(それ以外は415)。フォーム送信(クロスサイトから事前確認なしで送れる形式)を受け付けない。本体の無い要求(ログアウト等)はそのまま。
- **本体の大きさ**: 既定256KB、`POST /api/receipts` 14MB、`POST /api/receipts/ocr` 3MB(超えたら413)。
- **ヘッダー**: 全応答(API・画面の静的ファイル)に CSP(`default-src 'self'`、スクリプトは同一オリジンのファイルだけ、スタイルは同一オリジン+Google Fonts(style 属性だけ許可)、フォントは fonts.gstatic.com、画像は data:/blob:(領収書のプレビュー)、`connect-src 'self'`、`frame-ancestors 'none'`)、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、COOP/CORP same-origin、本番だけ HSTS(1年)。`/api/*` は `Cache-Control: no-store`。ビルド済みの画面をこのCSPで Chromium に読み込み、違反が出ないことを確認済み。
- **`GET /api/health/db`**: 認証なしで呼べるため、失敗時も `{status: 'error'}`(503)だけを返し、詳細はプロセスログに出す(成功は `{status: 'ok'}`)。
