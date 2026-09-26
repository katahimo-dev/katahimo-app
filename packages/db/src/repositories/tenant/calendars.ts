import type {
  BusyBlockInput,
  InstantRange,
  RetentionCutoffs,
  StaffBusyBlockRepository,
  StaffCalendarRecord,
  StaffCalendarRepository,
  TenantRetentionRepository,
} from '@katahimo/core/ports';
import { and, asc, eq, exists, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  careRecords,
  matchingRunCandidates,
  outboxMessages,
  passwordResetCodes,
  reportAiGenerations,
  sessions,
  staffBusyBlocks,
  staffCalendars,
} from '../../schema';
import { TenantBound } from './base';

function rangeLiteral(range: { start: Date; end: Date }) {
  return sql`tstzrange(${range.start.toISOString()}::timestamptz, ${range.end.toISOString()}::timestamptz, '[)')`;
}

export class DrizzleStaffCalendarRepository extends TenantBound implements StaffCalendarRepository {
  listAll(): Promise<StaffCalendarRecord[]> {
    return this.tx
      .select({
        id: staffCalendars.id,
        staffId: staffCalendars.staffId,
        calendarId: staffCalendars.calendarId,
        purpose: staffCalendars.purpose,
      })
      .from(staffCalendars)
      .where(eq(staffCalendars.tenantId, this.tenantId))
      .orderBy(asc(staffCalendars.staffId), asc(staffCalendars.purpose));
  }

  async setScheduleCalendar(staffId: string, calendarId: string | null, newId: string): Promise<void> {
    await this.tx
      .delete(staffCalendars)
      .where(
        and(
          eq(staffCalendars.tenantId, this.tenantId),
          eq(staffCalendars.staffId, staffId),
          eq(staffCalendars.purpose, 'schedule'),
        ),
      );
    if (calendarId) {
      await this.tx
        .insert(staffCalendars)
        .values({ tenantId: this.tenantId, id: newId, staffId, calendarId, purpose: 'schedule' });
    }
  }

  async recordSync(id: string, result: { at: Date; error: string | null }): Promise<void> {
    await this.tx
      .update(staffCalendars)
      .set({ lastSyncedAt: result.at, lastError: result.error })
      .where(and(eq(staffCalendars.tenantId, this.tenantId), eq(staffCalendars.id, id)));
  }
}

export class DrizzleStaffBusyBlockRepository extends TenantBound implements StaffBusyBlockRepository {
  async replaceInWindow(
    staffId: string,
    source: 'google_calendar',
    window: InstantRange,
    blocks: BusyBlockInput[],
  ): Promise<void> {
    await this.tx
      .delete(staffBusyBlocks)
      .where(
        and(
          eq(staffBusyBlocks.tenantId, this.tenantId),
          eq(staffBusyBlocks.staffId, staffId),
          eq(staffBusyBlocks.source, source),
          sql`${staffBusyBlocks.period} && ${rangeLiteral({ start: window.from, end: window.to })}`,
        ),
      );
    if (blocks.length === 0) return;
    await this.tx.insert(staffBusyBlocks).values(
      blocks.map((b) => ({
        tenantId: this.tenantId,
        id: b.id,
        staffId,
        source,
        period: { start: b.period.start, end: b.period.end },
        externalEventId: b.externalEventId ?? null,
      })),
    );
  }
}

/** 保存期間を過ぎた行の削除(ワーカーの保守ジョブ。テナントの RLS の中で消す)。 */
export class DrizzleTenantRetentionRepository extends TenantBound implements TenantRetentionRepository {
  async purge(cutoffs: RetentionCutoffs): Promise<Record<string, number>> {
    const t = this.tenantId;
    const deletedSessions = await this.tx
      .delete(sessions)
      .where(
        and(
          eq(sessions.tenantId, t),
          or(
            lt(sessions.absoluteExpiresAt, cutoffs.sessionsBefore),
            lt(sessions.idleExpiresAt, cutoffs.sessionsBefore),
            lt(sessions.revokedAt, cutoffs.sessionsBefore),
          ),
        ),
      )
      .returning({ id: sessions.id });
    const deletedOutbox = await this.tx
      .delete(outboxMessages)
      .where(
        and(
          eq(outboxMessages.tenantId, t),
          or(
            and(eq(outboxMessages.status, 'done'), lt(outboxMessages.completedAt, cutoffs.outboxDoneBefore)),
            and(
              inArray(outboxMessages.status, ['failed', 'dead']),
              lt(outboxMessages.completedAt, cutoffs.outboxFailedBefore),
            ),
          ),
        ),
      )
      .returning({ id: outboxMessages.id });
    const deletedCodes = await this.tx
      .delete(passwordResetCodes)
      .where(
        and(
          eq(passwordResetCodes.tenantId, t),
          lt(passwordResetCodes.expiresAt, cutoffs.passwordResetCodesBefore),
        ),
      )
      .returning({ id: passwordResetCodes.id });
    const clearedMailCodes = await this.tx
      .update(passwordResetCodes)
      .set({ mailCode: null })
      .where(
        and(
          eq(passwordResetCodes.tenantId, t),
          isNotNull(passwordResetCodes.mailCode),
          or(
            lte(passwordResetCodes.expiresAt, cutoffs.mailCodesExpiredAt),
            isNotNull(passwordResetCodes.usedAt),
          ),
        ),
      )
      .returning({ id: passwordResetCodes.id });
    const deletedCandidates = await this.tx
      .delete(matchingRunCandidates)
      .where(
        and(
          eq(matchingRunCandidates.tenantId, t),
          lt(matchingRunCandidates.createdAt, cutoffs.matchingCandidatesBefore),
        ),
      )
      .returning({ id: matchingRunCandidates.id });
    // AI 生成の記録: 日報に結び付いていないものは作成から一定期間、結び付いたものは日報の保存期限を過ぎたら
    const deletedGenerations = await this.tx
      .delete(reportAiGenerations)
      .where(
        and(
          eq(reportAiGenerations.tenantId, t),
          or(
            and(
              isNull(reportAiGenerations.careRecordId),
              lt(reportAiGenerations.createdAt, cutoffs.aiGenerationsUnlinkedBefore),
            ),
            exists(
              this.tx
                .select({ id: careRecords.id })
                .from(careRecords)
                .where(
                  and(
                    eq(careRecords.tenantId, t),
                    eq(careRecords.id, reportAiGenerations.careRecordId),
                    lt(careRecords.retainUntil, cutoffs.aiGenerationsLinkedRetainUntilBefore),
                  ),
                ),
            ),
          ),
        ),
      )
      .returning({ id: reportAiGenerations.id });
    return {
      sessions: deletedSessions.length,
      outbox_messages: deletedOutbox.length,
      password_reset_codes: deletedCodes.length,
      password_reset_mail_codes_cleared: clearedMailCodes.length,
      matching_run_candidates: deletedCandidates.length,
      report_ai_generations: deletedGenerations.length,
    };
  }
}
