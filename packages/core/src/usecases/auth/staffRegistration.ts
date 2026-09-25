import { newId, normalizeEmailForIndex, splitJapaneseFullName } from '../../domain';
import type { StaffRole } from '../../domain/model';
import type { StaffRecord } from '../../ports/staff';
import type { StaffRegistrationDeps } from './deps';

export interface RegisterStaffInput {
  tenantId: string;
  name: string;
  email: string;
  /** 省略時はパスワード未設定で登録する(本人がパスワード再設定の手順で初回設定する)。 */
  password?: string;
  /** GAS版のパスワードハッシュ(スタッフ台帳の移行)。 */
  legacyPasswordHash?: string | null;
  role: StaffRole;
  altEmail?: string | null;
  phone?: string | null;
  retiredOn?: string | null;
}

/**
 * スタッフを新規登録する(シード・管理者のスタッフ管理・台帳の取込)。メールは正規化して保存する
 * (ログインの検索キー)。メールの重複(他スタッフのサブメールとの重複を含む)は DB が拒否し conflict になる。
 */
export async function registerStaff(
  deps: StaffRegistrationDeps,
  input: RegisterStaffInput,
): Promise<StaffRecord> {
  const displayName = input.name.trim();
  const { familyName, givenName } = splitJapaneseFullName(displayName);
  const passwordHash = input.password ? await deps.passwordHasher.hash(input.password) : null;
  return deps.uow.run(input.tenantId, (r) =>
    r.staff.create({
      id: newId(),
      displayName,
      familyName,
      givenName,
      email: normalizeEmailForIndex(input.email),
      altEmail: input.altEmail ? normalizeEmailForIndex(input.altEmail) : null,
      phone: input.phone?.trim() || null,
      role: input.role,
      retiredOn: input.retiredOn ?? null,
      passwordHash,
      legacyPasswordHash: input.legacyPasswordHash ?? null,
    }),
  );
}
