import { normalizeEmailForIndex } from '../../domain';
import type { StaffRecord } from '../../ports/repositories';
import type { StaffRegistrationDeps } from './deps';

export interface RegisterStaffInput {
  tenantId: string;
  name: string;
  email: string;
  /** 省略時はパスワード未設定で登録する(本人がパスワード再設定の手順で初回設定する)。 */
  password?: string;
  isAdmin: boolean;
  altEmail?: string | null;
  phone?: string | null;
}

/**
 * スタッフを新規登録する(シード・管理者のスタッフ管理から使う)。メールは正規化して保存する
 * (ログイン時の検索キーになるため)。メールの重複確認は呼び出し側(usecases/staffAdmin.ts)が行う。
 */
export async function registerStaff(
  deps: StaffRegistrationDeps,
  input: RegisterStaffInput,
): Promise<StaffRecord> {
  return deps.staff.create({
    tenantId: input.tenantId,
    name: input.name.trim(),
    email: normalizeEmailForIndex(input.email),
    altEmail: input.altEmail ? normalizeEmailForIndex(input.altEmail) : null,
    phone: input.phone?.trim() || null,
    passwordHash: input.password ? await deps.passwordHasher.hash(input.password) : null,
    isAdmin: input.isAdmin,
  });
}

export interface ImportLegacyStaffInput {
  tenantId: string;
  name: string;
  email: string;
  /** GAS版 Auth.js の computeHash(password) で計算済みのハッシュ値(スタッフ台帳J列の値そのもの)。 */
  legacyPasswordHash: string;
  isAdmin: boolean;
}

/**
 * GAS版のスタッフ台帳から、既存のパスワードハッシュ(SHA-256+salt)ごとスタッフを1件移行する。
 * 初回ログイン成功時に login() がargon2idへサイレント再ハッシュする。
 * 台帳全体の一括取込は usecases/staffMasterImport.ts を使う。
 */
export async function importLegacyStaff(deps: StaffRegistrationDeps, input: ImportLegacyStaffInput) {
  return deps.staff.create({
    tenantId: input.tenantId,
    name: input.name.trim(),
    email: normalizeEmailForIndex(input.email),
    legacyPasswordHash: input.legacyPasswordHash,
    isAdmin: input.isAdmin,
  });
}
