import { normalizeEmailForIndex } from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { StaffPatch, StaffRepositoryPort } from '../ports/repositories';
import type { PasswordHasherPort } from './auth';

/**
 * GAS版スタッフ台帳(Staffシート)の1行を列の意味で表したもの。シートの列位置との対応付けは
 * 取込元(@katahimo/ingestion の staffMasterCsv)に閉じ込め、ここでは列記号を扱わない。
 */
export interface StaffMasterRow {
  /** 元CSVの行番号(1始まり、ヘッダー含む)。エラー表示用。 */
  rowNumber: number;
  name: string;
  email: string;
  /** サブメール。メールアドレスでない値(Chat ID等)は取込元で除外済み。 */
  altEmail: string | null;
  /** パスワード列の値。GAS版のSHA-256ハッシュ(64桁hex)か、移行前の平文、または空。 */
  password: string;
  isAdmin: boolean;
  /** 'YYYY-MM-DD' に正規化済み。 */
  retirementDate: string | null;
}

export interface StaffMasterImportDeps {
  staff: StaffRepositoryPort;
  passwordHasher: PasswordHasherPort;
  appLog: AppLogPort;
}

export interface StaffMasterImportResult {
  created: number;
  updated: number;
  skipped: { rowNumber: number; reason: string }[];
}

const LEGACY_HASH_PATTERN = /^[0-9a-f]{64}$/i;

type PasswordValue = { kind: 'legacy'; hash: string } | { kind: 'plain'; value: string } | { kind: 'none' };

/**
 * パスワード列の値の解釈。GAS版verifyLoginは「ハッシュ一致」に加え「平文一致(未移行)」も
 * 受け付けていたため、64桁hexはレガシーハッシュ、それ以外の値は平文パスワードとして扱う
 * (平文は取込時にargon2idへハッシュし、平文のままは保存しない)。
 */
function parsePassword(raw: string): PasswordValue {
  const value = raw.trim();
  if (!value) return { kind: 'none' };
  if (LEGACY_HASH_PATTERN.test(value)) return { kind: 'legacy', hash: value.toLowerCase() };
  return { kind: 'plain', value: raw };
}

/**
 * スタッフ台帳を一括取込する(メールアドレスで照合し、既存なら更新・無ければ作成)。
 * 既に本アプリでパスワード(argon2id)を設定済みのスタッフは、パスワードを上書きしない
 * (台帳の古いパスワードで戻ってしまうのを防ぐため)。
 */
export async function importStaffMasterRows(
  deps: StaffMasterImportDeps,
  tenantId: string,
  rows: StaffMasterRow[],
  options: { dryRun?: boolean } = {},
): Promise<StaffMasterImportResult> {
  const result: StaffMasterImportResult = { created: 0, updated: 0, skipped: [] };
  const seenEmails = new Set<string>();

  for (const row of rows) {
    const skip = (reason: string) => result.skipped.push({ rowNumber: row.rowNumber, reason });
    const name = row.name.trim();
    const email = normalizeEmailForIndex(row.email);
    if (!name || !email.includes('@')) {
      skip('氏名またはメールアドレスが空です');
      continue;
    }
    const altEmailCandidate = row.altEmail ? normalizeEmailForIndex(row.altEmail) : null;
    const altEmail = altEmailCandidate && altEmailCandidate !== email ? altEmailCandidate : null;
    if (seenEmails.has(email) || (altEmail && seenEmails.has(altEmail))) {
      skip('同じメールアドレスの行がCSV内で重複しています');
      continue;
    }

    const existing = await deps.staff.findByLoginEmail(tenantId, email);
    if (altEmail) {
      const altOwner = await deps.staff.findByLoginEmail(tenantId, altEmail);
      if (altOwner && altOwner.id !== existing?.id) {
        skip('サブメールが別のスタッフのメールアドレスと重複しています');
        continue;
      }
    }
    if (existing && existing.email !== email) {
      skip('メールアドレスが別のスタッフのサブメールとして登録済みです');
      continue;
    }
    seenEmails.add(email);
    if (altEmail) seenEmails.add(altEmail);

    const password = parsePassword(row.password);
    if (options.dryRun) {
      if (existing) result.updated++;
      else result.created++;
      continue;
    }

    if (existing) {
      const patch: StaffPatch = {
        name,
        altEmail,
        isAdmin: row.isAdmin,
        retirementDate: row.retirementDate,
      };
      const canReplacePassword = !existing.passwordHash;
      if (canReplacePassword && password.kind === 'legacy') patch.legacyPasswordHash = password.hash;
      await deps.staff.update(tenantId, existing.id, patch);
      if (canReplacePassword && password.kind === 'plain') {
        await deps.staff.updatePasswordHash(
          tenantId,
          existing.id,
          await deps.passwordHasher.hash(password.value),
        );
      }
      result.updated++;
    } else {
      await deps.staff.create({
        tenantId,
        name,
        email,
        altEmail,
        isAdmin: row.isAdmin,
        retirementDate: row.retirementDate,
        legacyPasswordHash: password.kind === 'legacy' ? password.hash : null,
        passwordHash: password.kind === 'plain' ? await deps.passwordHasher.hash(password.value) : null,
      });
      result.created++;
    }
  }

  if (!options.dryRun) {
    await deps.appLog.write({
      tenantId,
      level: 'SECURITY',
      action: 'staff.import.completed',
      details: { created: result.created, updated: result.updated, skipped: result.skipped.length },
    });
  }
  return result;
}
