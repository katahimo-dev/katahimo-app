import { newId, normalizeEmailForIndex, splitJapaneseFullName } from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { StaffPatch } from '../ports/staff';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { PasswordHasherPort } from './auth';

/**
 * GAS版スタッフ台帳(Staffシート)の1行を列の意味で表したもの。シートの列位置との対応は取込元
 * (@katahimo/ingestion の staffMasterCsv)に閉じ込め、ここでは列記号を扱わない。
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
  retiredOn: string | null;
}

export interface StaffMasterImportDeps {
  uow: UnitOfWorkPort;
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
 * パスワード列の解釈。GAS版 verifyLogin は「ハッシュ一致」に加え「平文一致(未移行)」も受け付けていたため、
 * 64桁hex はレガシーハッシュ、それ以外の値は平文パスワードとして扱う(平文は argon2id にして保存する)。
 */
function parsePassword(raw: string): PasswordValue {
  const value = raw.trim();
  if (!value) return { kind: 'none' };
  if (LEGACY_HASH_PATTERN.test(value)) return { kind: 'legacy', hash: value.toLowerCase() };
  return { kind: 'plain', value: raw };
}

/**
 * スタッフ台帳を一括取込する(メールで照合し、既存なら更新・無ければ作成)。全行を1トランザクションで適用し、
 * 取込の実行を import_runs に残す。既に本アプリでパスワード(argon2id)を設定済みのスタッフのパスワードは
 * 上書きしない(台帳の古いパスワードに戻らないように)。
 */
export async function importStaffMasterRows(
  deps: StaffMasterImportDeps,
  tenantId: string,
  rows: StaffMasterRow[],
  options: { dryRun?: boolean; fileName?: string | null } = {},
): Promise<StaffMasterImportResult> {
  const hashedPlain = new Map<number, string>();
  for (const row of rows) {
    const password = parsePassword(row.password);
    if (password.kind === 'plain')
      hashedPlain.set(row.rowNumber, await deps.passwordHasher.hash(password.value));
  }
  const runId = newId();

  const result = await deps.uow.run(tenantId, async (r) => {
    const outcome: StaffMasterImportResult = { created: 0, updated: 0, skipped: [] };
    const seen = new Set<string>();
    if (!options.dryRun) {
      await r.importRuns.start({
        id: runId,
        source: 'staff_master_csv',
        fileName: options.fileName ?? null,
        fileVersion: null,
        triggeredBy: null,
      });
    }
    for (const row of rows) {
      const skip = (reason: string) => outcome.skipped.push({ rowNumber: row.rowNumber, reason });
      const name = row.name.trim();
      const email = normalizeEmailForIndex(row.email);
      if (!name || !email.includes('@')) {
        skip('氏名またはメールアドレスが空です');
        continue;
      }
      const altCandidate = row.altEmail ? normalizeEmailForIndex(row.altEmail) : null;
      const altEmail = altCandidate && altCandidate !== email ? altCandidate : null;
      if (seen.has(email) || (altEmail && seen.has(altEmail))) {
        skip('同じメールアドレスの行がCSV内で重複しています');
        continue;
      }
      const existing = await r.staff.findByLoginEmail(email);
      if (altEmail) {
        const altOwner = await r.staff.findByLoginEmail(altEmail);
        if (altOwner && altOwner.id !== existing?.id) {
          skip('サブメールが別のスタッフのメールアドレスと重複しています');
          continue;
        }
      }
      if (existing && existing.email !== email) {
        skip('メールアドレスが別のスタッフのサブメールとして登録済みです');
        continue;
      }
      seen.add(email);
      if (altEmail) seen.add(altEmail);
      if (options.dryRun) {
        if (existing) outcome.updated++;
        else outcome.created++;
        continue;
      }

      const password = parsePassword(row.password);
      const split = splitJapaneseFullName(name);
      // 台帳には管理者かどうかしか無い。本アプリで付けたコーディネーターは管理者でない行でも保つ
      const role = row.isAdmin ? 'admin' : existing?.role === 'coordinator' ? 'coordinator' : 'staff';
      if (existing) {
        const patch: StaffPatch = {
          displayName: name,
          familyName: split.familyName,
          givenName: split.givenName,
          altEmail,
          role,
          retiredOn: row.retiredOn,
        };
        await r.staff.update(existing.id, patch);
        const credentials = await r.staff.getCredentials(existing.id);
        if (!credentials?.passwordHash) {
          if (password.kind === 'legacy') await r.staff.setLegacyPasswordHash(existing.id, password.hash);
          const plain = hashedPlain.get(row.rowNumber);
          if (plain) await r.staff.setPasswordHash(existing.id, plain);
        }
        outcome.updated++;
      } else {
        await r.staff.create({
          id: newId(),
          displayName: name,
          familyName: split.familyName,
          givenName: split.givenName,
          email,
          altEmail,
          role,
          retiredOn: row.retiredOn,
          legacyPasswordHash: password.kind === 'legacy' ? password.hash : null,
          passwordHash: hashedPlain.get(row.rowNumber) ?? null,
        });
        outcome.created++;
      }
    }
    if (!options.dryRun) {
      await r.importRuns.finish(runId, {
        status: 'applied',
        counts: { created: outcome.created, updated: outcome.updated, skipped: outcome.skipped.length },
        message: null,
      });
    }
    return outcome;
  });

  if (!options.dryRun) {
    await deps.appLog.write({
      tenantId,
      level: 'SECURITY',
      action: 'staff.import.completed',
      actorType: 'system',
      details: { created: result.created, updated: result.updated, skipped: result.skipped.length },
    });
  }
  return result;
}
