/**
 * DBアクセスのポート。実装はDrizzleスキーマを持つ @katahimo/db に置く
 * (このパッケージはDBクライアントに依存しないという境界を守るため、インターフェースだけ持つ)。
 */

export interface EncryptedField {
  ciphertext: string;
  keyVersion: number;
}

export interface StaffRecord {
  id: string;
  tenantId: string;
  /**
   * 氏名・メール・電話は平文で保持する(2026-08のデータベース構造レビューを踏まえ、要配慮性の
   * 低い通常の個人情報はフィールド暗号化の対象から外し、DB/バックアップの透過的暗号化(TDE)+
   * Row Level Security+アクセス制御に委ねる方針へ変更。doc/09参照)。emailは大文字小文字・
   * 前後空白を無視できるよう、書き込み時に`normalizeEmailForIndex`で正規化した値を保存する
   * (ログイン時の検索キーとして使うため、表記ゆれで一致しないと困る)。
   */
  name: string;
  email: string;
  phone: string | null;
  /** argon2id。GAS版から移行し未ログインのスタッフはnull(legacyPasswordHashのみ持つ)。 */
  passwordHash: string | null;
  /** GAS版のsha256(password+AUTH_SALT)。argon2idへの再ハッシュが完了したらnullに戻す。 */
  legacyPasswordHash: string | null;
  isAdmin: boolean;
  retirementDate: string | null;
}

export interface NewStaffInput {
  tenantId: string;
  name: string;
  email: string;
  phone?: string | null;
  /** 新規登録は必ずargon2idを渡す。GAS版からの移行はlegacyPasswordHashを渡し、こちらはnullにする。 */
  passwordHash?: string | null;
  legacyPasswordHash?: string | null;
  isAdmin: boolean;
}

/** 管理者向け「対象スタッフ」セレクタ用の最小情報。 */
export interface ActiveStaffRecord {
  id: string;
  name: string;
}

export interface StaffRepositoryPort {
  /** emailは呼び出し側が`normalizeEmailForIndex`で正規化済みの値を渡す前提(ログイン時の検索キー)。 */
  findByEmail(tenantId: string, email: string): Promise<StaffRecord | null>;
  findById(tenantId: string, staffId: string): Promise<StaffRecord | null>;
  create(input: NewStaffInput): Promise<StaffRecord>;
  /** ログイン成功時、レガシーハッシュをargon2idへサイレント再ハッシュするために使う。changePasswordでも同じ形の更新に使う。 */
  upgradeToArgon2Hash(tenantId: string, staffId: string, passwordHash: string): Promise<void>;
  /**
   * 退職済み(retirementDateが今日以前)を除いた全スタッフ。GAS版PastSchedule.js
   * getActiveStaffNames_に対応(管理者が「対象スタッフ」を選ぶセレクタ用)。
   * 氏名は暗号化されているため並び替えは呼び出し側(usecase)で復号後に行う。
   */
  listActive(tenantId: string): Promise<ActiveStaffRecord[]>;
}

export interface NewSessionInput {
  tenantId: string;
  staffId: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface SessionRecord {
  id: string;
  tenantId: string;
  staffId: string;
  expiresAt: Date;
}

export interface SessionRepositoryPort {
  create(input: NewSessionInput): Promise<SessionRecord>;
  /**
   * セッションCookieには `tenantId.rawToken` の形でテナントIDを含める(usecases/auth.ts の
   * encodeSessionCookie/decodeSessionCookie参照)ため、この検索は常にtenantIdが先に分かっている
   * 前提で呼ぶ。sessionsテーブルはRLS対象であり、tenantIdが分からないまま検索しようとすると
   * (app.tenant_idが未設定のため)常に0件になる、というRLSの設計上の制約に対応するための構造。
   */
  findByTokenHash(tenantId: string, tokenHash: string): Promise<SessionRecord | null>;
}

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
}

export interface NewTenantInput {
  name: string;
  slug: string;
}

export interface TenantRepositoryPort {
  findBySlug(slug: string): Promise<TenantRecord | null>;
  create(input: NewTenantInput): Promise<TenantRecord>;
  /** ミラーワーカー(packages/worker)がテナントごとにoutboxをポーリングするための全件取得。 */
  listAll(): Promise<TenantRecord[]>;
}

/**
 * 顧客プロファイル。RESERVA CSVの全列(パスワード列を除く)に対応するフィールドを持つ
 * (packages/db/src/schema/customers.ts参照)。
 *
 * 2026-08のデータベース構造レビュー(「DB個別暗号化は過剰、バックアップ暗号化で十分」という
 * 有識者指摘)を踏まえ、暗号化対象を要配慮性の高い項目(第三者情報・位置情報・自由記述・
 * 識別子)に絞った。氏名・連絡先・住所等の通常の個人情報はプレーンな文字列として保持し、
 * DB/バックアップの透過的暗号化(TDE)+Row Level Security+アクセス制御で保護する
 * (doc/09_データベース構造解説.md参照)。
 *
 * 平文: familyNameKana/givenNameKana/email/phone/addressDetail/city/parkingArea/parkingDetail/address2
 * 暗号化(EncryptedField)を維持: emergencyContact(第三者の連絡先)/emergencyContactRelation/
 * evacuationSite(最寄り校を特定しうる)/memo(自由記述で内容予測不可)/benefitMemberId(識別子)/
 * latLng(自宅の正確な位置情報)
 */
export interface CustomerProfileFields {
  externalSource: string | null;
  externalId: string | null;
  familyNameKana: string | null;
  givenNameKana: string | null;
  email: string | null;
  phone: string | null;
  addressDetail: string | null;
  city: string | null;
  parkingArea: string | null;
  parkingDetail: string | null;
  emergencyContact: EncryptedField | null;
  emergencyContactRelation: EncryptedField | null;
  evacuationSite: EncryptedField | null;
  memo: EncryptedField | null;
  benefitMemberId: EncryptedField | null;
  address2: string | null;
  address2StartDate: string | null;
  address2EndDate: string | null;
  latLng: EncryptedField | null;
  memberType: string | null;
  memberStatus: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  gender: string | null;
  ageBracket: string | null;
  registeredAt: Date | null;
  externalLastUpdatedAt: Date | null;
}

export interface CustomerRecord extends CustomerProfileFields {
  id: string;
  tenantId: string;
  name: string;
  /** 苗字だけの完全一致検索用(`normalizeStaffName`で正規化済み)。表示にはnameを使う。 */
  familyName: string;
  givenName: string;
  deactivatedAt: Date | null;
}

export interface NewCustomerInput extends Partial<CustomerProfileFields> {
  tenantId: string;
  name: string;
  familyName: string;
  givenName: string;
}

/** 顧客の更新は「渡されたフィールドだけ上書きする」部分更新(PATCH)方式。 */
export type CustomerPatchInput = Partial<NewCustomerInput>;

export interface CustomerRepositoryPort {
  create(input: NewCustomerInput): Promise<CustomerRecord>;
  findById(tenantId: string, customerId: string): Promise<CustomerRecord | null>;
  /** 苗字(正規化済み)の完全一致検索。呼び出し側は`normalizeStaffName`で正規化済みの値を渡す前提。 */
  findByFamilyName(tenantId: string, familyName: string): Promise<CustomerRecord[]>;
  findByExternalId(
    tenantId: string,
    externalSource: string,
    externalId: string,
  ): Promise<CustomerRecord | null>;
  /** 差分取込の比較対象にする、有効(未deactivate)な外部ID一覧。 */
  listActiveExternalIds(tenantId: string, externalSource: string): Promise<string[]>;
  /**
   * 有効(未deactivate)な顧客を全件返す。GAS版Main.js fetchDataFromSheetが顧客DB全件を
   * 一度にクライアントへ返し、以後は絞り込み/並び替えをすべてブラウザ側で行っていたのと
   * 同じ「訪問先一覧」画面用の一覧取得に使う。
   */
  listActive(tenantId: string): Promise<CustomerRecord[]>;
  update(tenantId: string, customerId: string, patch: CustomerPatchInput): Promise<CustomerRecord>;
  /** 物理削除はせず、deactivatedAtを設定するソフトデリート。 */
  deactivate(tenantId: string, customerId: string): Promise<void>;
}

export interface FamilyMemberRecord {
  id: string;
  tenantId: string;
  customerId: string;
  name: EncryptedField;
  dob: EncryptedField | null;
  info: EncryptedField | null;
}

export interface NewFamilyMemberInput {
  tenantId: string;
  customerId: string;
  name: EncryptedField;
  dob: EncryptedField | null;
  info: EncryptedField | null;
}

export interface FamilyMemberRepositoryPort {
  createMany(inputs: NewFamilyMemberInput[]): Promise<FamilyMemberRecord[]>;
  listByCustomerId(tenantId: string, customerId: string): Promise<FamilyMemberRecord[]>;
  /** 更新時は全件入れ替え(現在の世帯構成員一覧で置き換える)。誰が増減したかの追跡はしない。 */
  replaceForCustomer(
    tenantId: string,
    customerId: string,
    inputs: NewFamilyMemberInput[],
  ): Promise<FamilyMemberRecord[]>;
}

/**
 * 勤怠(出勤簿)1日分。rowDataは packages/core/src/domain/attendance/types.ts の
 * AttendanceRowData(入力列のみ)をJSON化して暗号化したもの。労働時間・残業・距離集計等の
 * 派生値は保存しない(常にrowDataから都度計算する。packages/db/src/schema/attendanceDays.ts参照)。
 */
export interface AttendanceDayRecord {
  id: string;
  tenantId: string;
  staffId: string;
  /** 'YYYY-MM-DD' */
  businessDate: string;
  rowData: EncryptedField;
}

export interface AttendanceDayRepositoryPort {
  findByStaffAndDate(
    tenantId: string,
    staffId: string,
    businessDate: string,
  ): Promise<AttendanceDayRecord | null>;
  /** 指定日のrowDataを丸ごと置き換える(無ければ作成)。入力列だけを持つ設計のため部分更新の概念が無い。 */
  upsert(
    tenantId: string,
    staffId: string,
    businessDate: string,
    rowData: EncryptedField,
  ): Promise<AttendanceDayRecord>;
  /** ミラーワーカー(packages/worker)がoutbox_jobs.targetIdから対象レコードを読み直すために使う。 */
  findById(tenantId: string, id: string): Promise<AttendanceDayRecord | null>;
  /** yearMonthは 'YYYY-MM'。月次集計(computeMonthlyTotals)の入力に使う。 */
  listByStaffAndMonth(tenantId: string, staffId: string, yearMonth: string): Promise<AttendanceDayRecord[]>;
  /** startDate〜endDateは両端とも 'YYYY-MM-DD' で含む。週間予定UI(Googleカレンダー風表示)の入力に使う。 */
  listByStaffAndDateRange(
    tenantId: string,
    staffId: string,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceDayRecord[]>;
}

/**
 * 保育日報1件。contentは packages/core/src/domain/reports/types.ts の DailyReportContent(JSON)を
 * 暗号化したもの(開始/終了時刻・メモ・社内向け/保護者向けレポート本文をまとめて1本にする。
 * attendance_daysのrowDataと同じ設計)。
 */
export interface DailyReportRecord {
  id: string;
  tenantId: string;
  staffId: string;
  customerId: string;
  occurredAt: Date;
  riskRating: number | null;
  esRating: number | null;
  content: EncryptedField;
}

export interface NewDailyReportInput {
  tenantId: string;
  staffId: string;
  customerId: string;
  occurredAt: Date;
  riskRating: number | null;
  esRating: number | null;
  content: EncryptedField;
}

export interface DailyReportRepositoryPort {
  create(input: NewDailyReportInput): Promise<DailyReportRecord>;
  /** 既存行の上書き保存(GAS版saveReportのrowIndex指定更新に相当)。存在しない/他テナントのIDならnullを返す。 */
  update(tenantId: string, id: string, input: NewDailyReportInput): Promise<DailyReportRecord | null>;
  findById(tenantId: string, id: string): Promise<DailyReportRecord | null>;
  /**
   * 指定顧客の日報を occurredAt 降順で取得する。beforeを渡した場合は occurredAt < before のみ
   * (カーソルページネーション。GAS版getCustomerReportsのstartAfterTimeに相当)。
   */
  listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<DailyReportRecord[]>;
}

/**
 * 事故報告/ヒヤリハット1件。contentは AccidentReportContent(JSON)を暗号化したもの。
 */
export interface AccidentReportRecord {
  id: string;
  tenantId: string;
  staffId: string;
  customerId: string;
  occurredAt: Date;
  reportType: string;
  content: EncryptedField;
}

export interface NewAccidentReportInput {
  tenantId: string;
  staffId: string;
  customerId: string;
  occurredAt: Date;
  reportType: string;
  content: EncryptedField;
}

export interface AccidentReportRepositoryPort {
  create(input: NewAccidentReportInput): Promise<AccidentReportRecord>;
  update(tenantId: string, id: string, input: NewAccidentReportInput): Promise<AccidentReportRecord | null>;
  findById(tenantId: string, id: string): Promise<AccidentReportRecord | null>;
  listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<AccidentReportRecord[]>;
}

/**
 * 領収書登録1件。GAS版processReceiptImagesの1画像分に相当。amount/storeNameは未入力ならnull。
 */
export interface ReceiptRecord {
  id: string;
  tenantId: string;
  staffId: string;
  customerId: string | null;
  receiptTimestamp: Date;
  amount: EncryptedField | null;
  storeName: EncryptedField | null;
  handoffText: EncryptedField | null;
  fileKey: string;
  contentType: string;
}

export interface NewReceiptInput {
  tenantId: string;
  staffId: string;
  customerId: string | null;
  receiptTimestamp: Date;
  dedupeBlindIndex: string | null;
  amount: EncryptedField | null;
  storeName: EncryptedField | null;
  handoffText: EncryptedField | null;
  fileKey: string;
  contentType: string;
}

export interface ReceiptRepositoryPort {
  create(input: NewReceiptInput): Promise<ReceiptRecord>;
  /** ミラーワーカー(packages/worker)がoutbox_jobs.targetIdから対象レコードを読み直すために使う。 */
  findById(tenantId: string, id: string): Promise<ReceiptRecord | null>;
  /**
   * dedupeBlindIndexの一致を確認する(GAS版processReceiptImagesの「シート上の既存データとの照合」
   * に相当)。バッチ内の重複は呼び出し側(usecase)がメモリ上で扱うため、ここはDBに既に永続化された
   * 行だけを対象にする。
   */
  findExistingDedupeIndexes(tenantId: string, dedupeBlindIndexes: string[]): Promise<Set<string>>;
}

/**
 * テナント単位の管理者設定。GAS版Script Properties(GEMINI_API_KEY・GEMINI_MODEL_REPORT/OCR・
 * GCHAT_REPORT_WEBHOOK_URL/GCHAT_RECEIPT_WEBHOOK_URL)に対応する。値はAPIキー/Webhook URLの
 * ような機微情報のみ暗号化し、モデル名は平文(検索/表示にしか使わないため)。
 */
export interface AppSettingsRecord {
  tenantId: string;
  geminiApiKey: EncryptedField | null;
  geminiReportModel: string | null;
  geminiOcrModel: string | null;
  gchatReportWebhookUrl: EncryptedField | null;
  gchatReceiptWebhookUrl: EncryptedField | null;
}

/** 渡されたフィールドだけ上書きする部分更新(PATCH)。行が無ければ作成する(upsert)。 */
export type AppSettingsPatchInput = Partial<Omit<AppSettingsRecord, 'tenantId'>>;

export interface AppSettingsRepositoryPort {
  find(tenantId: string): Promise<AppSettingsRecord | null>;
  upsert(tenantId: string, patch: AppSettingsPatchInput): Promise<AppSettingsRecord>;
}

/**
 * テナントごとのDEK(データ暗号化鍵)。KeyManagementPort(./kms.ts)でラップされた状態でのみ
 * 保持し、平文DEKは常にCryptoPort実装のプロセス内メモリにしか存在しない
 * (packages/db/src/schema/tenantKeys.ts参照)。
 */
export interface TenantKeyRecord {
  tenantId: string;
  dekVersion: number;
  wrappedDek: string;
  kekVersion: number;
  revokedAt: Date | null;
}

export interface TenantKeyRepositoryPort {
  find(tenantId: string): Promise<TenantKeyRecord | null>;
  /** 初回暗号化時、まだDEKが無いテナントのために新規作成する。 */
  create(tenantId: string, wrappedDek: string, kekVersion: number): Promise<TenantKeyRecord>;
  /** KEKローテーション時、DEK自体は変えずラップだけ新KEKバージョンで更新する(軽量操作)。 */
  updateWrappedDek(tenantId: string, wrappedDek: string, kekVersion: number): Promise<void>;
  /**
   * テナント解約時の暗号学的削除。DEKのレコードそのものを破棄し、以後
   * (バックアップに残った暗号文も含め)復号を永久に不可能にする。
   */
  revoke(tenantId: string): Promise<void>;
}
