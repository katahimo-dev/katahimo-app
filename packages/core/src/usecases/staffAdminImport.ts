import type { StaffImportIssue, StaffImportResponse } from '@katahimo/shared';
import {
  conflict,
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
import { type ResolvedStaffHome, resolveStaffHome } from './staffHome';

/**
 * 管理画面「スタッフ」の xlsx の書き出し・取込(GET /api/admin/staff/export.xlsx・POST /api/admin/staff/import)。
 * セルの読み取り・突き合わせは core/domain の staffSheet.ts、xlsx そのものは API 側。
 */

export interface StaffImportInput {
  /** xlsx のシートのセルの表(API が exceljs で読んだもの)。 */
  sheets: readonly StaffSheet[];
  dryRun: boolean;
  fileName: string | null;
}

export const STAFF_IMPORT_STALE_MESSAGE =
  'ファイルを確かめている間にスタッフの情報が変わりました。もう一度確かめてから取り込んでください';

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

/**
 * スタッフの xlsx の取込。dryRun は確かめるだけで何も書かない(import_runs・操作ログも残さない)。反映は誤りが
 * 1件も無いときだけ、全部を1つのトランザクションで書く(変わらない行は書かない)。自宅住所が変わる行はトランザクション
 * の前にジオコーディングする(見つからなければ住所だけを保存して知らせる)。トランザクションの中では在籍中の管理者の
 * 行をロックしてから今のスタッフを読み直して確かめ直し(その間に変わって誤りになれば 409)、import_runs
 * (source = staff_xlsx)に件数を残す。退職日が今日以前になったスタッフはセッションを失効し、通知の購読を消す。
 * パスワードは扱わない(新しいスタッフはパスワード未設定。案内のメールで本人が設定する)。
 */
export async function importStaffSheet(
  deps: StaffAdminDeps,
  actor: Actor,
  input: StaffImportInput,
): Promise<StaffImportResponse> {
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

  // 自宅住所のジオコーディング(トランザクションの外。同じ住所は1回だけ)
  const homes = new Map<string, ResolvedStaffHome>();
  for (const entry of plan.entries) {
    const address = entry.next.homeAddress;
    if (!entry.fields.includes('homeAddress') || !address) continue;
    if (!homes.has(address)) homes.set(address, await resolveStaffHome(deps.maps, address));
    const warning = GEOCODE_WARNINGS[homes.get(address)?.geocode ?? ''];
    if (warning) warnings.push({ row: entry.row, message: warning });
  }
  const homeOf = (address: string | null): StaffHome =>
    address
      ? (homes.get(address)?.home ?? { address, geo: null, geoCell: null })
      : { address: null, geo: null, geoCell: null };

  const runId = newId();
  let retired = 0;
  try {
    const applied = await deps.uow.run(
      actor.tenantId,
      async (r) => {
        const today = await todayOf(deps, r);
        await assertAdminsRemain(r, actor, today, null);
        const fresh = await planOf(r, actor, parsed);
        if (fresh.errors.length > 0) throw conflict(STAFF_IMPORT_STALE_MESSAGE, undefined, 'import_stale');
        await r.importRuns.start({
          id: runId,
          source: 'staff_xlsx',
          fileName: input.fileName,
          fileVersion: null,
          triggeredBy: actor.staffId,
        });
        for (const entry of fresh.entries) {
          if (entry.kind === 'unchanged') continue;
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
          } else if (Object.keys(patch).length > 0) {
            await r.staff.update(staffId, patch);
          }
          if (fields.includes('scheduleCalendarId')) {
            await r.staffCalendars.setScheduleCalendar(staffId, next.scheduleCalendarId, newId());
          }
          if (entry.staffId && fields.includes('retiredOn') && isRetiredOn(next.retiredOn, today)) {
            await revokeRetiredStaffAccess(deps, r, staffId);
            retired++;
          }
        }
        const response = responseOf(parsed, fresh, { dryRun: false, applied: true }, [], warnings);
        await r.importRuns.finish(runId, {
          status: 'applied',
          counts: { ...response.counts },
          message: warnings.length > 0 ? `知らせ ${warnings.length} 件` : null,
        });
        return response;
      },
      { actorId: actor.staffId },
    );
    await deps.appLog.write({
      tenantId: actor.tenantId,
      level: 'SECURITY',
      action: 'staff.xlsx_import.applied',
      actorStaffId: actor.staffId,
      details: { importRunId: runId, ...applied.counts, retired, warnings: warnings.length },
      ...actor.meta,
    });
    return applied;
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
