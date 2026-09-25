export interface ReservaFamilyMemberRow {
  name: string;
  dob: string;
  info: string;
}

/**
 * RESERVA顧客CSVの1行分。CSVの全列(パスワード列を除く)に対応する。
 * パスワード列(RESERVA側のログインパスワード)は、本アプリの認証に一切使わず他システムの
 * 認証情報を不必要に複製する理由がないため、意図的に取り込まない
 * (packages/db/src/schema/customers.ts の同内容のコメント参照)。
 */
export interface ReservaCsvRow {
  customerId: string;
  familyName: string;
  givenName: string;
  familyNameKana: string;
  givenNameKana: string;
  email: string;
  countryCode: string;
  phone: string;
  memberType: string;
  memberStatus: string;
  paymentMethod: string;
  paymentStatus: string;
  memo: string;
  /** ISO8601文字列。CSVのExcelシリアル日時から変換済み(変換できない場合はnull)。 */
  registeredAt: string | null;
  externalLastUpdatedAt: string | null;
  gender: string;
  ageBracket: string;
  address: string;
  parkingArea: string;
  parkingDetail: string;
  emergencyContact: string;
  emergencyContactRelation: string;
  evacuationSite: string;
  /** 「世帯全員の情報」欄の生テキスト。 */
  familyInfoRaw: string;
  /** parseFamilyInfo()で構造化した世帯構成員一覧。 */
  familyMembers: ReservaFamilyMemberRow[];
  benefitMemberId: string;
  address2: string;
  address2StartDate: string;
  address2EndDate: string;
  latLng: string;
}
