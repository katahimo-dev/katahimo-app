import { newId, normalizeEmailForIndex, splitJapaneseFullName, splitJapaneseKana } from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { MapsPort } from '../ports/maps';
import type { StaffHome, StaffPatch } from '../ports/staff';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { PasswordHasherPort } from './auth';
import { resolveStaffHome } from './staffHome';

/**
 * GAS版スタッフ台帳(Staffシート)の1行を列の意味で表したもの。シートの列位置との対応は取込元
 * (@katahimo/ingestion の staffMasterCsv)に閉じ込め、ここでは列記号を扱わない。
 */
export interface StaffMasterRow {
  /** 元CSVの行番号(1始まり、ヘッダー含む)。エラー表示用。 */
  rowNumber: number;
  name: string;
  /** カナ(「サトウ ハナコ」のように姓と名を空白で区切る。区切りが無ければ姓だけ)。空欄は null。 */
  kana: string | null;
  /** 電話。空欄は null。 */
  phone: string | null;
  email: string;
  /** 自宅住所(出勤・退勤経路の起点)。空欄は null。 */
  homeAddress: string | null;
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
  /** 自宅住所のジオコーディング(無ければ住所だけを保存し、ルート計算のときに住所からジオコーディングする)。 */
  maps?: MapsPort | undefined;
}

export interface StaffMasterImportResult {
  created: number;
  updated: number;
  skipped: { rowNumber: number; reason: string }[];
  /** 新しい自宅住所のうち、緯度経度を得られなかった(住所だけ保存した)件数。 */
  homeWithoutGeo: number;
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

/** 取込で自宅住所が変わる行の住所(既存の住所と同じものはジオコーディングし直さない)。 */
async function changedHomeAddresses(deps: StaffMasterImportDeps, tenantId: string, rows: StaffMasterRow[]) {
  const current = await deps.uow.run(tenantId, async (r) => {
    const byEmail = new Map<string, string | null>();
    for (const staff of await r.staff.listAll()) byEmail.set(staff.email, staff.homeAddress);
    return byEmail;
  });
  const addresses = new Set<string>();
  for (const row of rows) {
    if (row.homeAddress && current.get(normalizeEmailForIndex(row.email)) !== row.homeAddress)
      addresses.add(row.homeAddress);
  }
  return addresses;
}

/**
 * スタッフ台帳を一括取込する(メールで照合し、既存なら更新・無ければ作成)。全行を1トランザクションで適用し、
 * 取込の実行を import_runs に残す。既に本アプリでパスワード(argon2id)を設定済みのスタッフのパスワードは
 * 上書きしない(台帳の古いパスワードに戻らないように)。
 * カナ・電話・住所の空欄は既存の値を消さない(本アプリの管理画面で入れた値を台帳の空欄で消さないため)。
 * 住所が変わったら緯度経度も置き換える(トランザクションの前にジオコーディングし、得られなければ空にする)。
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
  const homes = new Map<string, StaffHome>();
  if (!options.dryRun) {
    for (const address of await changedHomeAddresses(deps, tenantId, rows)) {
      homes.set(address, (await resolveStaffHome(deps.maps, address)).home);
    }
  }
  const homeOf = (address: string): StaffHome => homes.get(address) ?? { address, geo: null, geoCell: null };

  const result = await deps.uow.run(tenantId, async (r) => {
    const outcome: StaffMasterImportResult = { created: 0, updated: 0, skipped: [], homeWithoutGeo: 0 };
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
      const kana = row.kana ? splitJapaneseKana(row.kana) : null;
      const home =
        row.homeAddress && row.homeAddress !== existing?.homeAddress ? homeOf(row.homeAddress) : null;
      if (home && !home.geo) outcome.homeWithoutGeo++;
      // 台帳には管理者かどうかしか無い。取込では権限を上げるだけで下げない(K列=1 なら管理者。空なら本アプリで
      // 付けた管理者・コーディネーターを保つ。権限を外すのは本アプリの管理画面で行う)
      const role = row.isAdmin ? 'admin' : (existing?.role ?? 'staff');
      if (existing) {
        const patch: StaffPatch = {
          displayName: name,
          familyName: split.familyName,
          givenName: split.givenName,
          altEmail,
          role,
          retiredOn: row.retiredOn,
          ...(kana ?? {}),
          ...(row.phone ? { phone: row.phone } : {}),
          ...(home ? { home } : {}),
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
          ...(kana ?? {}),
          email,
          altEmail,
          phone: row.phone,
          role,
          retiredOn: row.retiredOn,
          ...(home ? { home } : {}),
          legacyPasswordHash: password.kind === 'legacy' ? password.hash : null,
          passwordHash: hashedPlain.get(row.rowNumber) ?? null,
        });
        outcome.created++;
      }
    }
    if (!options.dryRun) {
      await r.importRuns.finish(runId, {
        status: 'applied',
        counts: {
          created: outcome.created,
          updated: outcome.updated,
          skipped: outcome.skipped.length,
          homeWithoutGeo: outcome.homeWithoutGeo,
        },
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
      details: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped.length,
        homeWithoutGeo: result.homeWithoutGeo,
      },
    });
  }
  return result;
}
