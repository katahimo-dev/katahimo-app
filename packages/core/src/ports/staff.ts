import type { GeoPoint } from '../domain/geo';
import type { Gender, StaffRole, TravelModeCode } from '../domain/model';

/** スタッフ(一覧・画面・権限の判定に使う形。認証情報は含めない)。 */
export interface StaffRecord {
  id: string;
  displayName: string;
  familyName: string;
  givenName: string;
  familyNameKana: string | null;
  givenNameKana: string | null;
  /** 主のログイン用メール(正規化済み)。 */
  email: string;
  /** 2つ目のログイン用メール(GAS版スタッフ台帳のサブメール)。 */
  altEmail: string | null;
  phone: string | null;
  role: StaffRole;
  /** 'YYYY-MM-DD'。この日以降はログインできない。 */
  retiredOn: string | null;
  gender: Gender | null;
  /** 自宅住所(出勤・退勤経路の起点)。 */
  homeAddress: string | null;
  /** 自宅の緯度経度(住所をジオコーディングできたとき)。無ければルート計算で住所をジオコーディングする。 */
  homeGeo: GeoPoint | null;
  travelMode: TravelModeCode | null;
  rowVersion: number;
}

/** 自宅。住所を変えたら緯度経度も必ず一緒に置き換える(古い住所の緯度経度を残さない)。 */
export interface StaffHome {
  address: string | null;
  geo: GeoPoint | null;
  /** geo の区画(geohash 6文字。geo が無ければ null)。 */
  geoCell: string | null;
}

export interface StaffCredentials {
  passwordHash: string | null;
  legacyPasswordHash: string | null;
}

export interface NewStaffInput {
  id: string;
  displayName: string;
  familyName: string;
  givenName: string;
  email: string;
  familyNameKana?: string | null;
  givenNameKana?: string | null;
  altEmail?: string | null;
  phone?: string | null;
  role: StaffRole;
  retiredOn?: string | null;
  home?: StaffHome;
  travelMode?: TravelModeCode | null;
  gender?: Gender | null;
  passwordHash?: string | null;
  legacyPasswordHash?: string | null;
}

/** 渡した項目だけを変える(null は削除)。 */
export interface StaffPatch {
  displayName?: string;
  familyName?: string;
  givenName?: string;
  familyNameKana?: string | null;
  givenNameKana?: string | null;
  email?: string;
  altEmail?: string | null;
  phone?: string | null;
  role?: StaffRole;
  retiredOn?: string | null;
  home?: StaffHome;
  travelMode?: TravelModeCode | null;
  gender?: Gender | null;
}

/** 削除の結果。referenced は業務の記録(勤怠・報告・領収書等)から参照されていて消せなかった。 */
export type StaffDeleteOutcome = 'deleted' | 'not_found' | 'referenced';

/** 予定・ルート計算に使うスタッフの属性(自宅・移動手段・予定を読むカレンダー)。 */
export interface StaffRouteProfile {
  id: string;
  displayName: string;
  homeAddress: string | null;
  homeGeo: GeoPoint | null;
  travelMode: TravelModeCode | null;
  /** 予定を読む Google カレンダー(staff_calendars の purpose = 'schedule')。 */
  scheduleCalendarId: string | null;
  retiredOn: string | null;
}

export interface StaffRepository {
  findById(id: string): Promise<StaffRecord | null>;
  /** メール・サブメールのどちらかが一致するスタッフ(呼び出し側で正規化済みの値を渡す)。 */
  findByLoginEmail(email: string): Promise<StaffRecord | null>;
  /** 退職者を含む全員。 */
  listAll(): Promise<StaffRecord[]>;
  /** date の時点で在籍している(retired_on が無いか date より後の)スタッフ。 */
  listActiveOn(date: string): Promise<StaffRecord[]>;
  /**
   * 作成する。メールの重複(他スタッフのメール・サブメールとの重複を含む)は DB の主キーで弾かれ、
   * conflict の DomainError になる。
   */
  create(input: NewStaffInput): Promise<StaffRecord>;
  /** expectedVersion を渡すと row_version が一致するときだけ更新する(違えば conflict)。無ければ null。 */
  update(id: string, patch: StaffPatch, expectedVersion?: number): Promise<StaffRecord | null>;
  /**
   * 業務の記録から参照されていなければ削除する(認証情報・ログイン用メール・セッション・カレンダー設定等の
   * スタッフに従属する行も一緒に消える)。参照されていれば何も変えずに referenced を返す。
   */
  deleteIfUnreferenced(id: string): Promise<StaffDeleteOutcome>;
  getCredentials(staffId: string): Promise<StaffCredentials | null>;
  /** argon2id のハッシュを設定し、GAS版のハッシュを消す(移行・変更・再設定)。 */
  setPasswordHash(staffId: string, passwordHash: string): Promise<void>;
  /** GAS版の台帳の再取込(本アプリのパスワードが未設定のスタッフだけ)。 */
  setLegacyPasswordHash(staffId: string, legacyPasswordHash: string): Promise<void>;
  /** ログイン失敗の写し(ロックの判定そのものはレート制限で行う)。 */
  recordLoginFailure(staffId: string, lockedUntil: Date | null): Promise<void>;
  recordLoginSuccess(staffId: string): Promise<void>;
  listRouteProfiles(): Promise<StaffRouteProfile[]>;
}

export interface SessionRecord {
  id: string;
  staffId: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export interface NewSessionInput {
  id: string;
  staffId: string;
  tokenHash: Uint8Array;
  createdAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export interface SessionRepository {
  create(input: NewSessionInput): Promise<void>;
  findByTokenHash(tokenHash: Uint8Array): Promise<SessionRecord | null>;
  /** 最終利用時刻と無操作の期限を延ばす(ローリング延長)。 */
  touch(id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  /** スタッフの全セッションを失効させる(exceptId は残す)。 */
  revokeAllForStaff(staffId: string, at: Date, exceptId?: string): Promise<void>;
}

export interface PasswordResetCodeRecord {
  id: string;
  staffId: string;
  codeHash: Uint8Array;
  sentToEmail: string;
  expiresAt: Date;
  usedAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
  /** メール送信待ちのコード。送信後・使用後は null。 */
  mailCode: string | null;
}

export interface NewPasswordResetCodeInput {
  id: string;
  staffId: string;
  codeHash: Uint8Array;
  sentToEmail: string;
  expiresAt: Date;
  maxAttempts: number;
  mailCode: string;
}

/**
 * パスワード再設定コード。試行回数の加算・使用済みへの遷移は並列の要求でも上限を超えないよう、
 * 実装が1文の条件付き UPDATE で原子的に行う。
 */
export interface PasswordResetCodeRepository {
  /** 同じスタッフの未使用のコードを使用済みにしてから1件作る(未使用は常に高々1件。DBの部分UNIQUEでも保証)。 */
  replaceActive(input: NewPasswordResetCodeInput, now: Date): Promise<PasswordResetCodeRecord>;
  findLatestUnused(staffId: string): Promise<PasswordResetCodeRecord | null>;
  findById(id: string): Promise<PasswordResetCodeRecord | null>;
  /** 未使用・期限内・試行回数が上限未満のときだけ試行を1回数え、その後の行を返す(条件外なら null)。 */
  registerAttempt(id: string, now: Date): Promise<PasswordResetCodeRecord | null>;
  /** 未使用なら使用済みにして true(同じコードでの同時の再設定は1件だけ成功する)。 */
  consume(id: string, now: Date): Promise<boolean>;
  markUsed(id: string, at: Date): Promise<void>;
  clearMailCode(id: string): Promise<void>;
}
