import { DomainError } from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type {
  ScheduleLightResult,
  SchedulePort,
  ScheduleTarget,
  ScheduleWithRouteResult,
} from '../ports/schedule';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { RequestMeta } from './requestMeta';

export interface ScheduleDeps {
  schedule: SchedulePort;
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
}

/**
 * 予定閲覧の要求。targetStaffId は呼び出し側(API の resolveTargetStaffId)で「他人を扱えないロールは本人」を
 * 済ませた値を渡すこと(CLAUDE.md の admin-vs-self)。
 */
export interface ScheduleViewRequest {
  tenantId: string;
  /** 操作したスタッフ。夜間ジョブ(翌日の予定のお知らせ)は null。 */
  actorStaffId: string | null;
  targetStaffId: string;
  /** 'YYYY-MM-DD'(JSTの業務日) */
  date: string;
  /** ログに添える送信元情報。 */
  meta?: RequestMeta;
}

export interface ScheduleRouteViewRequest extends ScheduleViewRequest {
  /** 「🔄 再取得」ボタン。共有キャッシュを読まずに再計算する(結果はキャッシュに書き直す)。 */
  forceRefresh: boolean;
}

/** 勤怠記録へ書き込む処理(カレンダー反映・夜間バッチ)用の要求。バッチ等で操作者がいなければnull。 */
export interface FreshScheduleRouteRequest {
  tenantId: string;
  actorStaffId: string | null;
  targetStaffId: string;
  date: string;
}

/**
 * 指定日の予定一覧(ルート・移動時間を含まない軽量版)。GAS版Schedule.js getScheduleForDate相当。
 * タブを開くたびに呼ばれる軽量な閲覧のため、成功時はログを残さない(失敗時のみ)。
 */
export async function getScheduleForStaff(
  deps: ScheduleDeps,
  request: ScheduleViewRequest,
): Promise<ScheduleLightResult> {
  return runLogged(deps, 'schedule.view', request, async (target) => {
    const result = await deps.schedule.getSchedule(target, request.date, { tenantId: request.tenantId });
    return { result, logSuccess: false };
  });
}

/**
 * 指定日の予定にルート・移動時間を付与して返す。GAS版Schedule.js getRouteForStaffOnDate相当。
 * 地図APIの有料呼び出しを伴うため、成功時も誰が実行したかをINFOで記録する。
 */
export async function getScheduleWithRouteForStaff(
  deps: ScheduleDeps,
  request: ScheduleRouteViewRequest,
): Promise<ScheduleWithRouteResult> {
  return runLogged(deps, 'schedule.route', request, async (target) => {
    const result = await deps.schedule.getScheduleWithRoute(target, request.date, request.forceRefresh, {
      tenantId: request.tenantId,
    });
    return { result, logSuccess: true, details: { forceRefresh: request.forceRefresh } };
  });
}

/**
 * 共有キャッシュを一切使わずに、その時点のカレンダーからルートつき予定を計算する。
 * 出勤簿・勤怠集計など公式な記録へ書き込む処理は必ずこれを使うこと(GAS版
 * refreshAttendanceForStaffOnDate がキャッシュを使わないのと同じ規則)。
 */
export async function getFreshScheduleWithRouteForStaff(
  deps: ScheduleDeps,
  request: FreshScheduleRouteRequest,
): Promise<ScheduleWithRouteResult> {
  return runLogged(deps, 'schedule.route_fresh', request, async (target) => {
    const result = await deps.schedule.getScheduleWithRoute(target, request.date, false, {
      tenantId: request.tenantId,
      fresh: true,
    });
    return { result, logSuccess: true };
  });
}

type FailedResult = ReturnType<typeof failed>;

function failed(message: string) {
  return { success: false, message, appointments: [] };
}

interface LoggedOutcome<T> {
  result: T;
  logSuccess: boolean;
  details?: Record<string, unknown>;
}

/**
 * 対象スタッフの解決(SchedulePort は staffId で対象を決め、氏名はカレンダーの予定の文字列の突き合わせに使う)と、
 * ログ規約の適用:
 * 失敗(success:false)はWARN、例外はERRORで常に記録し、成功は logSuccess のときだけINFOで記録する。
 * 他スタッフの予定を扱った場合は targetStaffId も残す。例外は upstream_unavailable(502)にする。
 */
async function runLogged<T extends ScheduleLightResult | ScheduleWithRouteResult>(
  deps: ScheduleDeps,
  action: string,
  request: {
    tenantId: string;
    actorStaffId: string | null;
    targetStaffId: string;
    date: string;
    meta?: RequestMeta;
  },
  run: (target: ScheduleTarget) => Promise<LoggedOutcome<T>>,
): Promise<T | FailedResult> {
  const log = (level: 'INFO' | 'WARN' | 'ERROR', suffix: string, details: Record<string, unknown>) =>
    deps.appLog.write({
      tenantId: request.tenantId,
      level,
      action: `${action}.${suffix}`,
      actorStaffId: request.actorStaffId,
      targetStaffId: request.targetStaffId !== request.actorStaffId ? request.targetStaffId : null,
      details: { date: request.date, ...details },
      ...request.meta,
    });

  try {
    const staffRecord = await deps.uow.run(request.tenantId, (r) => r.staff.findById(request.targetStaffId));
    if (!staffRecord) {
      await log('WARN', 'failed', { reason: 'staff_not_found' });
      return failed('スタッフが見つかりません');
    }
    const { result, logSuccess, details } = await run({
      staffId: staffRecord.id,
      staffName: staffRecord.displayName,
    });
    if (!result.success) {
      await log('WARN', 'failed', { message: result.message ?? '不明なエラー' });
    } else if (logSuccess) {
      await log('INFO', 'succeeded', { appointmentCount: result.appointments?.length ?? 0, ...details });
    }
    return result;
  } catch (e) {
    if (e instanceof DomainError) throw e;
    // 外部サービス(カレンダー・地図)の失敗の詳細はログにだけ残し、画面には一般的な文言を返す(502)
    await log('ERROR', 'error', { message: e instanceof Error ? e.message : String(e) });
    throw new DomainError(
      'upstream_unavailable',
      UPSTREAM_FAILURE_MESSAGE,
      undefined,
      'schedule_upstream_failed',
    );
  }
}

export const UPSTREAM_FAILURE_MESSAGE =
  '予定を取得できませんでした。しばらくしてから、もう一度お試しください。';
