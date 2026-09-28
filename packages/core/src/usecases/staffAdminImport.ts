import type { StaffImportIssue, StaffImportResponse } from '@katahimo/shared';
import {
  conflict,
  invalid,
  isRetiredOn,
  newId,
  type ParsedStaffSheet,
  parseStaffSheet,
  planStaffImport,
  type StaffImportPlan,
  type StaffSheet,
  type StaffSheetExport,
  type StaffSheetFieldKey,
  type StaffSheetFinal,
  staffSheetLabelOf,
  staffToSheet,
} from '../domain';
import type { StaffHome } from '../ports/staff';
import type { TenantRepositories } from '../ports/unitOfWork';
import type { Actor } from './requestMeta';
import type { StaffAdminDeps } from './staffAdmin';
import { listStaffForAdmin } from './staffAdmin';
import {
  assertAdminsRemain,
  revokeRetiredStaffAccess,
  type StaffFieldsInput,
  scheduleCalendarsOf,
  staffPatchOf,
  todayOf,
} from './staffAdminInternals';
import { type HomeGeocodeStatus, type ResolvedStaffHome, resolveStaffHome } from './staffHome';

/**
 * 管理画面「スタッフ」の xlsx の書き出し・取込(GET /api/admin/staff/export.xlsx・POST /api/admin/staff/import)。
 * セルの読み取り・突き合わせは core/domain の staffSheet.ts、xlsx そのものは API 側。
 */

export interface StaffImportInput {
  /** xlsx のシートのセルの表(API が exceljs で読んだもの)。 */
  sheets: readonly StaffSheet[];
  dryRun: boolean;
  fileName: string | null;
  /** 反映する(dryRun = false)ときは必須。確かめた(dryRun)ときの応答の planDigest。 */
  planDigest?: string | null | undefined;
}

export const STAFF_IMPORT_STALE_MESSAGE =
  '確かめた後に他の人がスタッフの情報を変えました。もう一度ファイルを選んで確かめてから取り込んでください';

export const STAFF_IMPORT_DIGEST_REQUIRED_MESSAGE = '先にファイルを確かめてから取り込んでください';

/** 書き出し(退職者を含む全員、氏名順)。スタッフの個人情報をまとめて持ち出すため SECURITY で残す。 */
export async function exportStaffSheet(deps: StaffAdminDeps, actor: Actor): Promise<StaffSheetExport> {
  const staff = await listStaffForAdmin(deps, actor.tenantId);
  await deps.appLog.write({
    tenantId: actor.tenantId,
    level: 'SECURITY',
    action: 'staff.export.downloaded',
    actorStaffId: actor.staffId,
    details: { count: staff.length },
    ...actor.meta,
  });
  return staffToSheet(staff);
}

async function planOf(
  r: TenantRepositories,
  actor: Actor,
  parsed: ParsedStaffSheet,
): Promise<StaffImportPlan> {
  const calendars = await scheduleCalendarsOf(r);
  const staff = (await r.staff.listAll()).map((s) => ({
    ...s,
    scheduleCalendarId: calendars.get(s.id) ?? null,
  }));
  return planStaffImport(parsed, {
    staff,
    actorStaffId: actor.staffId,
    calendarSettings: await r.calendarSettings(),
  });
}

function responseOf(
  parsed: ParsedStaffSheet,
  plan: StaffImportPlan,
  flags: { dryRun: boolean; applied: boolean },
  errors: StaffImportIssue[],
  warnings: StaffImportIssue[],
): StaffImportResponse {
  const count = (kind: 'create' | 'update' | 'unchanged') =>
    plan.entries.filter((e) => e.kind === kind).length;
  return {
    ...flags,
    counts: {
      rows: parsed.rowCount,
      created: count('create'),
      updated: count('update'),
      unchanged: count('unchanged'),
    },
    changes: plan.entries
      .filter((e) => e.kind !== 'unchanged')
      .map((e) => ({
        row: e.row,
        kind: e.kind as 'create' | 'update',
        name: e.next.name,
        email: e.next.email,
        fields: e.fields.map(staffSheetLabelOf),
      })),
    errors,
    warnings,
    planDigest: plan.digest,
  };
}

/** 変わる項目のうち staff の列で持つもの(自宅・予定のカレンダーは別に扱う)。 */
function fieldsInput(next: StaffSheetFinal, fields: readonly StaffSheetFieldKey[]): StaffFieldsInput {
  const input: StaffFieldsInput = {};
  for (const key of fields) {
    if (key === 'homeAddress' || key === 'scheduleCalendarId') continue;
    Object.assign(input, { [key]: next[key] });
  }
  return input;
}

const GEOCODE_WARNINGS: Partial<Record<string, string>> = {
  not_found: '自宅住所の場所が見つかりませんでした(住所だけを保存します)',
  failed: '自宅住所の場所を地図で調べられませんでした(住所だけを保存します)',
};

/** 反映で書いたスタッフ1人分(コミットの後にスタッフごとの操作ログにする。値は残さず項目の名前だけ)。 */
interface AppliedStaff {
  staffId: string;
  kind: 'create' | 'update';
  fields: StaffSheetFieldKey[];
  next: StaffSheetFinal;
  homeGeocode: HomeGeocodeStatus | null;
}

/**
 * 反映のトランザクションの中身。メールアドレス・サブメールが変わるスタッフは、先に全員のログイン用メールを外してから
 * 1人ずつ書く(ファイルの中でメールを入れ替えても、1人ずつ書き直す途中で主キーが重ならないように。取込の後の状態で
 * 重ならないことは planStaffImport が確かめてある)。
 */
async function applyPlan(
  deps: StaffAdminDeps,
  r: TenantRepositories,
  plan: StaffImportPlan,
  today: string,
  homes: ReadonlyMap<string, ResolvedStaffHome>,
): Promise<{ applied: AppliedStaff[]; retired: number }> {
  const homeOf = (address: string | null): StaffHome =>
    address
      ? (homes.get(address)?.home ?? { address, geo: null, geoCell: null })
      : { address: null, geo: null, geoCell: null };
  const changing = plan.entries.filter((e) => e.kind !== 'unchanged');
  const emailMoves = new Set(
    changing
      .filter((e) => e.staffId && (e.fields.includes('email') || e.fields.includes('altEmail')))
      .map((e) => e.staffId as string),
  );
  await r.staff.releaseLoginEmails([...emailMoves]);

  const applied: AppliedStaff[] = [];
  let retired = 0;
  for (const entry of changing) {
    const { next, fields } = entry;
    const patch = staffPatchOf(fieldsInput(next, fields));
    if (fields.includes('homeAddress')) patch.home = homeOf(next.homeAddress);
    let staffId = entry.staffId;
    if (staffId === null) {
      staffId = newId();
      await r.staff.create({
        id: staffId,
        displayName: patch.displayName ?? next.name,
        familyName: patch.familyName ?? '',
        givenName: patch.givenName ?? '',
        familyNameKana: patch.familyNameKana ?? null,
        givenNameKana: patch.givenNameKana ?? null,
        email: patch.email ?? next.email,
        altEmail: patch.altEmail ?? null,
        phone: patch.phone ?? null,
        role: next.role,
        retiredOn: next.retiredOn,
        travelMode: patch.travelMode ?? null,
        gender: patch.gender ?? null,
        ...(patch.home ? { home: patch.home } : {}),
        passwordHash: null,
      });
    } else {
      if (emailMoves.has(staffId)) {
        // 外したログイン用メールを、取込の後の値(メール・サブメールの両方)で書き直す
        patch.email = next.email;
        patch.altEmail = next.altEmail;
      }
      if (Object.keys(patch).length > 0) await r.staff.update(staffId, patch);
    }
    if (fields.includes('scheduleCalendarId')) {
      await r.staffCalendars.setScheduleCalendar(staffId, next.scheduleCalendarId, newId());
    }
    if (entry.staffId && fields.includes('retiredOn') && isRetiredOn(next.retiredOn, today)) {
      await revokeRetiredStaffAccess(deps, r, staffId);
      retired++;
    }
    applied.push({
      staffId,
      kind: entry.kind as 'create' | 'update',
      fields,
      next,
      homeGeocode:
        fields.includes('homeAddress') && next.homeAddress
          ? (homes.get(next.homeAddress)?.geocode ?? null)
          : null,
    });
  }
  return { applied, retired };
}

/** スタッフごとの操作ログ(画面の登録・更新と同じ action・形に、取込の印 via と import_runs の ID を足す)。 */
async function logAppliedStaff(
  deps: StaffAdminDeps,
  actor: Actor,
  importRunId: string,
  applied: readonly AppliedStaff[],
): Promise<void> {
  for (const s of applied) {
    const changed = (key: StaffSheetFieldKey) => s.kind === 'create' || s.fields.includes(key);
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'SECURITY',
      action: s.kind === 'create' ? 'staff.admin.created' : 'staff.admin.updated',
      actorStaffId: actor.staffId,
      targetStaffId: s.staffId,
      details: {
        via: 'staff_xlsx',
        importRunId,
        changedFields: s.fields,
        ...(changed('role') ? { role: s.next.role } : {}),
        ...(changed('retiredOn') && (s.kind === 'update' || s.next.retiredOn)
          ? { retiredOn: s.next.retiredOn }
          : {}),
        ...(s.kind === 'create' ? { initialPasswordSet: false } : {}),
        ...(s.homeGeocode ? { homeGeocode: s.homeGeocode } : {}),
      },
      ...actor.meta,
    });
  }
}

/**
 * スタッフの xlsx の取込。dryRun は確かめるだけで何も書かない(import_runs・操作ログも残さない)。応答の planDigest は
 * 反映する内容の指紋で、反映(dryRun = false)には確かめたときの planDigest が要る(無ければ 400)。反映は誤りが1件も
 * 無く、指紋が確かめたときと同じときだけ、全部を1つのトランザクションで書く(変わらない行は書かない)。自宅住所が変わる
 * 行はトランザクションの前にジオコーディングする(見つからなければ住所だけを保存して知らせる)。トランザクションの中では
 * 在籍中の管理者の行をロックしてから今のスタッフを読み直して確かめ直し(その間に変わって誤りになる・指紋が変われば 409
 * import_stale)、import_runs(source = staff_xlsx)に件数を残す。退職日が今日以前になったスタッフはセッションを失効し、
 * 通知の購読を消す。コミットの後に、まとめ(staff.xlsx_import.applied)とスタッフごと(staff.admin.created /
 * staff.admin.updated、via = staff_xlsx)の SECURITY を残す。パスワードは扱わない(新しいスタッフはパスワード未設定。
 * 案内のメールで本人が設定する)。
 */
export async function importStaffSheet(
  deps: StaffAdminDeps,
  actor: Actor,
  input: StaffImportInput,
): Promise<StaffImportResponse> {
  if (!input.dryRun && !input.planDigest) {
    throw invalid(
      STAFF_IMPORT_DIGEST_REQUIRED_MESSAGE,
      { planDigest: STAFF_IMPORT_DIGEST_REQUIRED_MESSAGE },
      'plan_digest_required',
    );
  }
  const parsed = parseStaffSheet(input.sheets);
  const plan = await deps.uow.run(actor.tenantId, (r) => planOf(r, actor, parsed));
  const errors = [...parsed.errors, ...plan.errors];
  const warnings = [...parsed.warnings];
  if (input.dryRun || errors.length > 0) {
    if (!input.dryRun) {
      await deps.appLog.write({
        tenantId: actor.tenantId,
        level: 'WARN',
        action: 'staff.xlsx_import.rejected',
        actorStaffId: actor.staffId,
        details: { reason: 'has_errors', errors: errors.length },
        ...actor.meta,
      });
    }
    return responseOf(parsed, plan, { dryRun: input.dryRun, applied: false }, errors, warnings);
  }

  const runId = newId();
  try {
    // 確かめた後に変わっていれば、地図APIを呼ぶ前に断る(トランザクションの中でもう一度確かめる)
    if (plan.digest !== input.planDigest) {
      throw conflict(STAFF_IMPORT_STALE_MESSAGE, undefined, 'import_stale');
    }
    // 自宅住所のジオコーディング(トランザクションの外。同じ住所は1回だけ)
    const homes = new Map<string, ResolvedStaffHome>();
    const geocode = { geocoded: 0, notFound: 0, failed: 0 };
    for (const entry of plan.entries) {
      const address = entry.next.homeAddress;
      if (!entry.fields.includes('homeAddress') || !address) continue;
      if (!homes.has(address)) {
        const resolved = await resolveStaffHome(deps.maps, address);
        homes.set(address, resolved);
        if (resolved.geocode === 'ok') geocode.geocoded++;
        else if (resolved.geocode === 'not_found') geocode.notFound++;
        else if (resolved.geocode === 'failed') geocode.failed++;
      }
      const warning = GEOCODE_WARNINGS[homes.get(address)?.geocode ?? ''];
      if (warning) warnings.push({ row: entry.row, message: warning });
    }

    const { response, applied, retired } = await deps.uow.run(
      actor.tenantId,
      async (r) => {
        const today = await todayOf(deps, r);
        await assertAdminsRemain(r, actor, today, null);
        const fresh = await planOf(r, actor, parsed);
        if (fresh.errors.length > 0 || fresh.digest !== input.planDigest) {
          throw conflict(STAFF_IMPORT_STALE_MESSAGE, undefined, 'import_stale');
        }
        await r.importRuns.start({
          id: runId,
          source: 'staff_xlsx',
          fileName: input.fileName,
          fileVersion: null,
          triggeredBy: actor.staffId,
        });
        const written = await applyPlan(deps, r, fresh, today, homes);
        const response = responseOf(parsed, fresh, { dryRun: false, applied: true }, [], warnings);
        await r.importRuns.finish(runId, {
          status: 'applied',
          counts: { ...response.counts },
          message: warnings.length > 0 ? `知らせ ${warnings.length} 件` : null,
        });
        return { response, ...written };
      },
      { actorId: actor.staffId },
    );
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'SECURITY',
      action: 'staff.xlsx_import.applied',
      actorStaffId: actor.staffId,
      details: {
        importRunId: runId,
        ...response.counts,
        retired,
        warnings: warnings.length,
        geocode,
      },
      ...actor.meta,
    });
    await logAppliedStaff(deps, actor, runId, applied);
    return response;
  } catch (error) {
    const reason = (error as { reason?: string } | null)?.reason;
    if (reason) {
      await deps.appLog.write({
        tenantId: actor.tenantId,
        level: 'WARN',
        action: 'staff.xlsx_import.rejected',
        actorStaffId: actor.staffId,
        details: { reason },
        ...actor.meta,
      });
    }
    throw error;
  }
}
