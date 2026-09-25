import { resolveSession } from '@katahimo/core';
import type { ResolvedSession } from '@katahimo/core/usecases';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Container } from './container';

export const SESSION_COOKIE_NAME = 'katahimo_session';

/**
 * リクエストのCookieからログイン中ユーザーを解決する唯一の入口。
 *
 * CLAUDE.mdのセキュリティパターン(クライアント指定のスタッフ名/テナントIDを一切信用しない)
 * をAPI全体で1箇所に集約するためのヘルパー。各ルートはこの戻り値の`tenantId`/`staffId`だけを
 * 使い、リクエストボディやクエリパラメータのtenantId/staffId(があっても)は無視すること。
 */
export async function getAuthenticatedSession(c: Context, container: Container) {
  const cookieValue = getCookie(c, SESSION_COOKIE_NAME);
  if (!cookieValue) return null;
  return resolveSession(container, cookieValue);
}

/**
 * 管理者以外は自分自身のstaffIdに強制し、管理者だけが明示的なstaffIdクエリで
 * 他スタッフを指定できるようにする。
 *
 * 移植元: gas-childcare-visit-app/PastSchedule.js の resolvePastScheduleTargetStaffName_
 * (getPastScheduleAccessContext_とセットで使われるパターン)と同じ考え方。この関数は
 * 「管理者が他スタッフの勤怠を閲覧/編集する」機能を追加するたびに複製せず、ここに集約する。
 */
export function resolveAttendanceTargetStaffId(
  session: ResolvedSession,
  requestedStaffId: string | undefined,
): string {
  if (!session.isAdmin) return session.staffId;
  const requested = (requestedStaffId ?? '').trim();
  return requested || session.staffId;
}

/**
 * 日報/事故報告/領収書登録用。管理者以外は自分自身のstaffIdに強制し、管理者だけが
 * 明示的なstaffId指定で他スタッフの名義の報告を保存できるようにする。
 *
 * GAS版Main.js saveReport/saveAccidentReportの
 * `if (!session.isAdmin || !reportData.staffName) { reportData.staffName = session.name; }`
 * と同じ規則(resolveAttendanceTargetStaffIdと判定ロジックは同一だが、CLAUDE.mdの方針
 * (アクセスコンテキストごとに独立実装する)に沿って報告系専用の関数として分けている)。
 */
export function resolveReportTargetStaffId(
  session: ResolvedSession,
  requestedStaffId: string | undefined,
): string {
  if (!session.isAdmin) return session.staffId;
  const requested = (requestedStaffId ?? '').trim();
  return requested || session.staffId;
}

/**
 * 「予定」タブ用。管理者以外は自分自身のstaffIdに強制し、管理者だけが明示的なstaffId指定で
 * 他スタッフの予定を閲覧できるようにする。
 *
 * 移植元: gas-childcare-visit-app/Schedule.js の resolveScheduleTargetStaffName_と同じ考え方
 * (判定ロジックはresolveAttendanceTargetStaffIdと同一だが、CLAUDE.mdの方針
 * (アクセスコンテキストごとに独立実装する)に沿って予定系専用の関数として分けている)。
 */
export function resolveScheduleTargetStaffId(
  session: ResolvedSession,
  requestedStaffId: string | undefined,
): string {
  if (!session.isAdmin) return session.staffId;
  const requested = (requestedStaffId ?? '').trim();
  return requested || session.staffId;
}
