# 予定・ルート計算(「今日/明日の予定」)の実装と設定

GAS版 `RouteSearch.js`(`getScheduleForStaffOnDate` / `getScheduleWithRouteForStaffOnDate`)が行っていた
「Googleカレンダーの予定を分類し、自宅→訪問先→自宅の移動時間・距離を付けて返す」処理を、
GASに頼らずGCP上で単独で動かすための実装と設定手順をまとめる。

API(`GET /api/schedule`、`GET /api/schedule/route`)の応答の形はGAS版(=GASブリッジ経由)と
同一で、画面(`packages/web`)は実装の切り替えを意識しない。

## 1. 構成

| 層 | ファイル | 役割 |
| --- | --- | --- |
| ドメイン(純粋関数) | `packages/core/src/domain/schedule/` | GAS版ロジックの移植。タイトルのタグ解析・予約の担当者/顧客突合・事務作業の結合・担当スタッフの抽出・経路区間の決定・住所2の適用・表示用の値の組み立て |
| ポート | `packages/core/src/ports/` | `SchedulePort`(schedule.ts)、`GoogleCalendarPort`(googleCalendar.ts)、`MapsPort`(maps.ts)、`CachePort`(cache.ts)、`ScheduleDirectoryPort`(scheduleDirectory.ts)、`StaffCalendarRepository` / `StaffBusyBlockRepository`(calendars.ts) |
| ユースケース | `packages/core/src/usecases/schedule.ts` | 対象スタッフの読み込み(`SchedulePort` にはスタッフIDと DB の氏名 `ScheduleTarget` を渡す)とログ記録。外部サービスの例外は詳細をログに残し、一般的な文言の 502 にする。`getScheduleForStaff` / `getScheduleWithRouteForStaff` / `getFreshScheduleWithRouteForStaff` |
| | `packages/core/src/usecases/scheduleDirectory.ts` | 顧客・スタッフを DB から1トランザクションで読み、緯度経度を復号する(復号の監査は1件)。テナント × 顧客データの版数ごとにキャッシュし、同時の読み込みは1回にまとめる |
| | `packages/core/src/usecases/staffBusyBlocks.ts` | マッチング用 free/busy の同期(`syncStaffBusyBlocks` / `syncStaffBusyBlocksForAllTenants`) |
| アダプター | `packages/integrations/src/google-schedule/` | `GoogleSchedulePort`(取得・実行・キャッシュ)、`RouteCalculator`(実行内メモ) |
| | `packages/integrations/src/google-calendar/` | Google Calendar API(サービスアカウント、読み取り専用) |
| | `packages/integrations/src/google-maps/` | Geocoding API + Routes API(computeRoutes) |
| | `packages/integrations/src/cache/` | プロセス内TTL付きLRU(`CachePort` 実装) |
| | `packages/integrations/src/gas-bridge/` | 移行期の実装(GAS版Web App `Bridge.js` に委ねる) |
| | `packages/integrations/src/schedule-provider/` | 実装の選択(`selectScheduleProvider` / `createScheduleServices`) |
| DB | `packages/db/src/repositories/tenant/staff.ts`(`listRouteProfiles`) | スタッフの自宅・移動手段・予定を読むカレンダーの読み取り |

## 2. 実装の切り替え(`SCHEDULE_PROVIDER`)

| 値 | 実装 | 内容 |
| --- | --- | --- |
| `google` | `GoogleSchedulePort` + `GoogleMapsPlatformPort` | Google Calendar API と Google Maps Platform を直接呼ぶ。GAS不要 |
| `gas_bridge` | `GasBridgeSchedulePort` + `GasBridgeMapsPort` | 稼働中のGAS版Web App(`Bridge.js`)に計算ごと委ねる(従来どおり) |
| `noop` | `NoopSchedulePort` + `NoopMapsPort` | 常に「予定なし」。ローカル開発用 |

未指定の場合は次の順で決まる(`packages/integrations/src/schedule-provider/scheduleProvider.ts`)。

1. `GOOGLE_MAPS_API_KEY` と `GOOGLE_APPLICATION_CREDENTIALS` が両方あれば `google`
2. `GAS_BRIDGE_URL` と `GAS_BRIDGE_SECRET` が両方あれば `gas_bridge`
3. どちらも無ければ `noop`

Cloud Run では Workload Identity(実行サービスアカウント)を使い `GOOGLE_APPLICATION_CREDENTIALS` を
設定しないため、**本番は `SCHEDULE_PROVIDER=google` を明示する**。明示した実装に必要な設定が欠けていれば
起動時にエラーで止まる。起動時に `予定・ルート計算の実装: google` のように選ばれた実装をログに出す。

## 3. 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `SCHEDULE_PROVIDER` | 本番は必須 | `google` / `gas_bridge` / `noop` |
| `GOOGLE_MAPS_API_KEY` | `google` で必須 | Geocoding API と Routes API を有効にしたAPIキー(Secret Managerから注入する) |
| `GOOGLE_APPLICATION_CREDENTIALS` | ローカルのみ | サービスアカウントキー(JSON)のパス。Cloud Run では不要 |
| `GOOGLE_CALENDAR_IDS` | 任意 | `staff_calendars`(`purpose = 'schedule'`) 以外に読むカレンダー。カンマ区切りで `カレンダーID` または `カレンダーID=持ち主のスタッフ名` |
| `GOOGLE_CALENDAR_IMPERSONATE` | 任意 | ドメイン全体の委任で成り代わるWorkspaceユーザー(例: `info@cutest.biz`) |
| `GAS_BRIDGE_URL` / `GAS_BRIDGE_SECRET` | `gas_bridge` で必須 | GAS版Web Appの `/exec` URL と `BRIDGE_API_SECRET` |

## 4. GCPで有効にするAPI

同じGCPプロジェクトで次の3つを有効にする(「APIとサービス」→「ライブラリ」)。

- **Google Calendar API** — 予定の取得・free/busy(サービスアカウントで呼ぶ。無料・クォータのみ)
- **Geocoding API** — 住所→緯度経度(顧客DBに緯度経度が無い住所・住所2・予定の場所・自宅住所)
- **Routes API** — 経路の所要時間・距離(`computeRoutes`)。レガシーの Directions API は2025年3月以降の
  新規プロジェクトでは有効化できないため使わない(doc/07 第10.3章)

APIキーは「認証情報」で作成し、**APIの制限で Geocoding API と Routes API だけに絞る**。サーバーから
呼ぶためブラウザのリファラ制限は使えない。Cloud Run の送信元IPは固定されないため、IP制限をかける場合は
Cloud NAT で固定IPを割り当てる。キーは Secret Manager に置き、Cloud Run の環境変数として注入する。

## 5. サービスアカウントとカレンダーへのアクセス

GAS版は実行アカウント(info@cutest.biz)が購読している全カレンダーを `CalendarApp.getAllCalendars()` で
読んでいた。サーバーにはこれに相当する「全部」が無いため、読むカレンダーを明示し、サービスアカウントに
読み取り権限を与える。方式は2つ。

### 方式A: カレンダーをサービスアカウントに共有する(推奨)

1. GCPで実行用サービスアカウントを作る(例: `katahimo-api@<project>.iam.gserviceaccount.com`)。
   Cloud Run のサービスにこのアカウントを割り当てる(キーの発行は不要)。ローカル開発では
   キー(JSON)を発行して `GOOGLE_APPLICATION_CREDENTIALS` にパスを入れる。
2. 読みたい各カレンダー(各スタッフのカレンダー、RESERVAの予約が入るカレンダー)の
   「設定と共有」→「特定のユーザーまたはグループと共有する」にサービスアカウントのメールアドレスを追加し、
   権限を **「予定の表示(すべての予定の詳細)」** にする。「予定の表示(時間枠のみ)」ではタイトルが
   読めずタグ判定ができない(free/busy同期だけなら時間枠のみで足りる)。
   - Workspace の管理コンソールで外部共有が制限されている場合でも、同じ組織のプロジェクトの
     サービスアカウントには共有できる(できない場合は方式Bを使う)。
3. カレンダーIDを登録する: スタッフ本人のカレンダーは `staff_calendars`(`purpose = 'schedule'`)(通常は本人のメールアドレス)、
   それ以外(共有カレンダー等)は `GOOGLE_CALENDAR_IDS`。

### 方式B: ドメイン全体の委任(domain-wide delegation)

1. サービスアカウントの「詳細」→「ドメイン全体の委任を有効にする」を行い、クライアントIDを控える。
2. Workspace 管理コンソール →「セキュリティ」→「APIの制御」→「ドメイン全体の委任」で、そのクライアントIDに
   スコープ `https://www.googleapis.com/auth/calendar.readonly` を許可する。
3. `GOOGLE_CALENDAR_IMPERSONATE` に成り代わるユーザー(GAS版の実行アカウント `info@cutest.biz` 等、
   対象カレンダーを購読・閲覧できるユーザー)を設定する。
4. 成り代わりにはサービスアカウントの秘密鍵での署名が必要なため、**キー(JSON)を
   `GOOGLE_APPLICATION_CREDENTIALS` で渡す必要がある**(Cloud Run のメタデータサーバーの資格情報では
   `subject` を指定できない)。キーは Secret Manager にファイルとしてマウントする。
   委任はドメイン内の全ユーザーの全カレンダーを読める強い権限なので、方式Aが使えるなら方式Aにする。

## 6. どのカレンダーを読むか・予定の持ち主

テナントごとに次の2つを合わせて読む(同じカレンダーIDは1回だけ。`calendarSources.ts`)。

1. `staff_calendars`(`purpose = 'schedule'`) があるスタッフのカレンダー — 持ち主はそのスタッフ
2. `GOOGLE_CALENDAR_IDS` — 持ち主は `=` の後の名前、省略時はカレンダーの名前(Google Calendarの summary)

「持ち主」は、GAS版でカレンダー名がスタッフ名として使われていたのと同じ役割を持つ:
`[新規]` `[事務]` と、ゲストのいない `[イベント]` はカレンダーの持ち主の予定になる。
`[予約確定]` は説明欄の「施設：<スタッフ名>[」で担当者が決まる(無ければ持ち主)。
同じ予定(iCalUID)が複数のカレンダーにあれば、上の順で先に読んだカレンダーの持ち主になる。

`GOOGLE_CALENDAR_IDS` は全テナント共通の設定のため、**複数テナントで運用する場合は `staff_calendars`(`purpose = 'schedule'`) だけを使う**
(テナント単位のカレンダー設定は未追加。追加するなら `tenant_settings`)。

閲覧時に読めないカレンダーがあった場合は、そのカレンダーを飛ばして WARN(`schedule.calendar_read_failed`)を記録する。
勤怠記録用の `fresh` 計算では、予定が欠けたまま記録しないよう失敗させる。

## 7. スタッフの自宅と移動手段

GAS版は出勤経路(自宅→最初の訪問先)・退勤経路(最後の訪問先→自宅)の起点に、スタッフ台帳の
「住所」「緯度・経度」列を使っていた。新アプリでは次の列を使う。

| GAS版スタッフ台帳 | 新アプリ | 備考 |
| --- | --- | --- |
| 緯度・経度 | `staff.home_lat_lng_ciphertext` / `home_lat_lng_key_version` | `'緯度,経度'` をCryptoPortで暗号化した値(顧客の `lat_lng` と同じ形式) |
| 住所 | `staff.custom_fields.homeAddress` | **暫定**。staffテーブルに住所文字列の列が無く、スキーマ凍結中のため `custom_fields` に置く |
| (なし・全員自動車) | `staff.travel_mode` | `car` / `bicycle` / `transit` / `walk`。未設定は `car`(GAS版と同じ) |

緯度経度があればそれを使い、無ければ `homeAddress` をジオコーディングする(毎回の計算で1回、課金対象)。
どちらも無いスタッフは出勤・退勤経路が空欄になる。現時点ではこれらを設定する画面・取込処理は無い
(`importLegacyStaff.ts` はスタッフ台帳の住所列を取り込んでいない)。暫定の設定方法:

```sql
-- テナントを設定してから(RLS)。自宅住所(平文)・移動手段
SELECT set_config('app.tenant_id', '<tenant id>', false);
UPDATE staff SET home_address = '東京都世田谷区用賀4-1-1', travel_mode = 'bicycle' WHERE id = '<staff id>';
-- 予定を読むカレンダー
INSERT INTO staff_calendars (tenant_id, id, staff_id, calendar_id, purpose)
VALUES ('<tenant id>', gen_random_uuid(), '<staff id>', 'sato@cutest.biz', 'schedule');
```

緯度経度は暗号化が必要なためSQLでは直接入れられない(スタッフ編集機能の追加時に CryptoPort 経由で保存する)。

## 8. 分類・経路のルール(GAS版から移植)

`packages/core/src/domain/schedule/` に移植し、GAS版 `RouteSearch.js` を Node の vm 上で実際に動かして
同じ入力で結果が完全一致することをテストしている(`packages/integrations/src/google-schedule/gasParity.test.ts`)。

- 1日の範囲は JST の 0:00〜翌0:00。範囲に一部でも重なる予定を読む。終日予定は JST 0:00〜翌0:00(表示は `00:00`〜`00:00`)
- タイトルのタグ: `[予約確定]` > `[新規]` > `[イベント]` > `[事務]` の優先順で1つに決まる。タグの無い予定は対象外
- `[予約確定]`: タイトルから全タグを除いた氏名を、空白の違いを無視して顧客DB(`customers.name`)と突合。
  顧客IDは RESERVA の顧客ID(`customers.external_id`)。説明欄に「オンライン」を含む予約は場所を持たない。
  予約詳細URLは説明欄の最初のURL
- `[事務]` は同じスタッフの時間が重なるもの(ちょうど終了時刻に始まるものは除く)を1件にまとめる
  (名前は「,」区切り、場所は最初の予定)。終日の `[事務]` があるとその日の事務作業はすべて1件になる
- 持ち主が「いいえ」と回答した予定はそのカレンダーの分としては読まない
- 経路: 位置情報(緯度経度または住所)のある予定だけを時刻順につなぎ、自宅→最初、予定間、最後→自宅。
  住所2(`address2` と適用期間)が当日を含めば、登録済みの緯度経度より住所2を優先してジオコーディングする
- 値: 所要時間は分に四捨五入(数値)、距離は km 小数2桁の文字列。算出できない区間は `''`。
  経路URLは `https://www.google.com/maps/dir/?api=1&origin=..&destination=..&travelmode=<移動手段>`

GAS版から意図的に変えた点:

- オンライン予約: GAS版は顧客オブジェクトそのものの住所を消しており、同じ日に同じ顧客の対面予約が
  あるとそちらの住所まで消えていた。ここでは該当予定の場所だけを空にする
- 軽量版(`GET /api/schedule`)では地図APIを一切呼ばない(GAS版は `[新規]` 等の場所を無駄にジオコーディングしていた)
- 空白を除いて同名のスタッフが複数いる場合、GAS版は台帳で先の1人にしか予定が出なかったが、ここでは全員に出る
- 経路計算は Routes API の `TRAFFIC_UNAWARE`(GAS版の DirectionFinder と同じく交通状況を考慮しない)。
  経路・所要時間の算出エンジンが Directions API と異なるため、同じ区間でも値が数分・数百m変わることはある

## 9. キャッシュ

GAS版の3層のキャッシュとの対応:

| GAS版 | 新アプリ | 範囲 |
| --- | --- | --- |
| `CacheService`(ルート結果2時間) | `InMemoryTtlCache`(`CachePort`)、キー `schedule-route:v2:<tenantId>:<スタッフID>:<日付>`、TTL 2時間、最大2000件のLRU | **APIプロセス内**。Cloud Run でインスタンスが複数立つとインスタンス間で共有されない(各インスタンスが別々に計算・課金する)。共有が必要になったら Memorystore 実装に `CachePort` ごと差し替える |
| `GEOCODE_MEMO_CACHE_` / `DIRECTIONS_MEMO_CACHE_` | `RouteCalculator`(1回の計算=1スタッフ×1日の中だけ) | 同じ住所・同じ区間を1回の計算の中で2回問い合わせない。通信エラー等の失敗は覚えない |
| `CacheService`(顧客・スタッフ30分) | なし | DBから毎回読む(スプレッドシート全読みと違い軽いため) |
| ブラウザ `localStorage`(2時間) | `packages/web` 側(変更なし) | ブラウザごと |

- 通常の閲覧(`/api/schedule/route`): キャッシュがあればそれを返す
- 「🔄 再取得」(`forceRefresh=1`): キャッシュを読まずに再計算し、結果をキャッシュに書き直す
- 勤怠記録へ書き込む処理(カレンダー反映・夜間バッチ): **必ず `getFreshScheduleWithRouteForStaff`
  (= `getScheduleWithRoute(..., { tenantId, fresh: true })`)を使う**。キャッシュを読みも書きもしない
  (GAS版 `refreshAttendanceForStaffOnDate` と同じ規則)。`gas_bridge` では `forceRefresh` として送る
  (GAS側のキャッシュに結果が書かれる点だけが異なる)

## 10. ログ(`app_logs`)

| action | level | 内容 |
| --- | --- | --- |
| `schedule.route.succeeded` / `schedule.route_fresh.succeeded` | INFO | ルート計算(有料の地図API呼び出し)。操作者・(管理者が他スタッフを見た場合)対象スタッフ・日付・件数 |
| `schedule.view.failed` / `schedule.route.failed` / `schedule.route_fresh.failed` | WARN | `success:false` の結果(スタッフ不明等) |
| `schedule.view.error` / `schedule.route.error` / `schedule.route_fresh.error` | ERROR | 例外(入力不正・カレンダー取得失敗(fresh)等) |
| `schedule.calendar_read_failed` | WARN | 閲覧時に読めなかったカレンダー(スタッフのカレンダーならスタッフID、それ以外はカレンダーID) |
| `schedule.route_leg_failed` | WARN | 一部の区間のジオコーディング/経路計算の失敗理由(住所は記録しない) |
| `calendar.busy_blocks.sync` / `calendar.busy_blocks.sync_error` | INFO/WARN/ERROR | free/busy 同期の結果 |

軽量版の成功はログを残さない(GAS版と同じ、開くたびに呼ばれる閲覧のため)。

## 11. 料金の目安

2025年3月からの Google Maps Platform の料金体系(SKUごとに毎月の無料枠あり)での目安。
**正確な単価・無料枠は必ず公式の料金ページで確認すること**。

- Geocoding API(Essentials): 1,000件あたり約5米ドル、月1万件まで無料
- Routes API Compute Routes(Essentials): 1,000件あたり約5米ドル、月1万件まで無料。
  `TRAFFIC_AWARE` 等を使うと上位SKU(単価約2倍)になるため、交通状況は考慮しない設定にしている
- Google Calendar API: 無料(クォータのみ)

1回のルート計算で呼ぶのは、区間数(位置情報ありの予定数+1)の Routes と、緯度経度の無い住所数の
Geocoding。例: スタッフ20人×1日3件の訪問×毎日1回の計算 → Routes 約80件/日・約2,400件/月で無料枠内。
2時間キャッシュが効くため同じ日の再表示では課金されないが、インスタンスが複数立つとインスタンスの数だけ
計算されうる(9章)。夜間バッチ等で全スタッフを `fresh` で計算する場合はその分が毎回課金される。
顧客DBに緯度経度が登録されていればジオコーディングは発生しない(RESERVA CSVの「緯度・経度」列)。

## 12. マッチング用 free/busy 同期

`syncStaffBusyBlocks(deps, tenantId, window)` は `staff_calendars`(`purpose = 'schedule'`) のある在籍スタッフの free/busy を
Calendar API から取得し(50カレンダーずつ)、`staff_busy_blocks`(source=`google_calendar`)の該当期間を
置き換える。予定のタイトル・場所は取得も保存もしない。全テナント分は `syncStaffBusyBlocksForAllTenants`。
ワーカーからは次のように組み立てて呼ぶ(スケジューラーへの登録はまだ行っていない):

```ts
await syncStaffBusyBlocksForAllTenants(
  {
    tenants: new DrizzleTenantRepository(db),
    calendar: createGoogleCalendarPort(env),
    staffRouteProfiles: new DrizzleStaffRouteProfileRepository(db),
    busyBlocks: new DrizzleStaffBusyBlockRepository(db),
    appLog: new DrizzleAppLogRepository(db),
  },
  { from: jstDayRange(today).from, to: jstDayRange(twoWeeksLater).to },
);
```
