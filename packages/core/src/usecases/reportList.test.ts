import { beforeEach, describe, expect, it } from 'vitest';
import { reportExcerpt, reportTimeLabel } from '../domain';
import { exportReports, getReportDetail, listReports, type ReportExportRow } from './reportList';
import type { SaveDailyReportInput } from './reports';
import { saveAccidentReport, saveDailyReport } from './reports';
import type { Actor } from './requestMeta';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

const ACCIDENT_BODY = {
  targetName: '佐藤 はな',
  targetDob: '2022/04/01',
  occurrenceTime: '10:30頃',
  location: '公園',
  accidentContent: '転んでひざをすりむいた',
  situation: '走っていた',
  immediateResponse: '洗って絆創膏',
  parentCorrespondence: 'お迎え時に説明',
  diagnosisTreatment: 'なし',
  prevention: '見守りを増やす',
  inputText: 'ころんだ',
};

async function collect(rows: AsyncGenerator<ReportExportRow[]>): Promise<ReportExportRow[]> {
  const all: ReportExportRow[] = [];
  for await (const batch of rows) all.push(...batch);
  return all;
}

describe('日報・事故報告の一覧', () => {
  let ctx: TestContext;
  let staff: Actor;
  let other: Actor;
  let coordinator: Actor;
  let customerId: string;
  let otherCustomerId: string;

  const daily = (overrides: Partial<SaveDailyReportInput> = {}): SaveDailyReportInput => ({
    customerId,
    reportDate: '2026-09-20',
    startTime: '09:00',
    endTime: '12:00',
    inputText: 'メモ',
    internalText: '社内向けの文',
    customerText: '保護者向け',
    riskRating: 1,
    esRating: 4,
    ...overrides,
  });

  beforeEach(async () => {
    ctx = createTestContext();
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    other = (await ctx.addStaff('鈴木 次郎', 'jiro@example.com')).actor;
    coordinator = (await ctx.addStaff('調整 役', 'coord@example.com', 'coordinator')).actor;
    customerId = await ctx.addCustomer('佐藤 花子', 'R-001');
    otherCustomerId = await ctx.addCustomer('田中 一郎', 'R-002');
  });

  it('コーディネーターは全員分を新しい順に見られ、閲覧を記録する', async () => {
    await saveDailyReport(ctx.deps, staff, daily({ reportDate: '2026-09-20' }));
    await saveDailyReport(ctx.deps, other, daily({ reportDate: '2026-09-22', customerId: otherCustomerId }));
    await saveAccidentReport(ctx.deps, staff, {
      customerId,
      reportType: 'ヒヤリハット',
      ...ACCIDENT_BODY,
    });
    const page = await listReports(ctx.deps, coordinator, { limit: 30 });
    expect(page.range).toEqual({ from: '2026-08-26', to: '2026-09-25' });
    expect(page.timeZone).toBe('Asia/Tokyo');
    expect(page.reports.map((r) => [r.kind, r.date, r.time, r.staffName, r.customerName])).toEqual([
      ['near_miss', '2026-09-25', '12:00', '山田 太郎', '佐藤 花子'],
      ['daily_report', '2026-09-22', '09:00〜12:00', '鈴木 次郎', '田中 一郎'],
      ['daily_report', '2026-09-20', '09:00〜12:00', '山田 太郎', '佐藤 花子'],
    ]);
    expect(page.reports[0]?.excerpt).toBe('転んでひざをすりむいた');
    expect(page.reports[1]).toMatchObject({ excerpt: '社内向けの文', riskRating: 1, esRating: 4 });
    expect(page.nextCursor).toBeNull();
    const logs = ctx.appLog.byAction('report.list.viewed');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'INFO', actorStaffId: coordinator.staffId, targetStaffId: null });
  });

  it('絞り込み(スタッフ・お客様・種類・期間)が効く', async () => {
    await saveDailyReport(ctx.deps, staff, daily({ reportDate: '2026-09-01' }));
    await saveDailyReport(ctx.deps, other, daily({ reportDate: '2026-09-10', customerId: otherCustomerId }));
    await saveAccidentReport(ctx.deps, other, { customerId, reportType: '事故報告', ...ACCIDENT_BODY });
    const ids = async (q: Parameters<typeof listReports>[2]) =>
      (await listReports(ctx.deps, coordinator, q)).reports.map((r) => [r.staffId, r.kind]);
    expect(await ids({ limit: 30, staffId: other.staffId })).toEqual([
      [other.staffId, 'accident'],
      [other.staffId, 'daily_report'],
    ]);
    expect(await ids({ limit: 30, customerId: otherCustomerId })).toEqual([[other.staffId, 'daily_report']]);
    expect(await ids({ limit: 30, kind: 'accident' })).toEqual([[other.staffId, 'accident']]);
    expect(await ids({ limit: 30, from: '2026-09-01', to: '2026-09-01' })).toEqual([
      [staff.staffId, 'daily_report'],
    ]);
  });

  it('一般スタッフは staffId を送っても本人の記録だけ(本人だけなら閲覧は記録しない)', async () => {
    await saveDailyReport(ctx.deps, staff, daily());
    await saveDailyReport(ctx.deps, other, daily());
    const page = await listReports(ctx.deps, staff, { limit: 30, staffId: other.staffId });
    expect(page.reports.map((r) => r.staffId)).toEqual([staff.staffId]);
    expect(ctx.appLog.byAction('report.list.viewed')).toHaveLength(0);
  });

  it('keyset ページングで同じ時刻の記録も重複・抜けなく読める(続きのページは閲覧を記録しない)', async () => {
    for (let i = 0; i < 5; i++) await saveDailyReport(ctx.deps, staff, daily({ inputText: `m${i}` }));
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let n = 0; n < 5; n++) {
      const page = await listReports(ctx.deps, coordinator, { limit: 2, cursor });
      seen.push(...page.reports.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(ctx.appLog.byAction('report.list.viewed')).toHaveLength(1);
    await expect(listReports(ctx.deps, coordinator, { limit: 2, cursor: 'xxx' })).rejects.toMatchObject({
      code: 'validation_failed',
      reason: 'invalid_cursor',
    });
  });

  it('期間は366日まで、逆転した期間は断る', async () => {
    await expect(
      listReports(ctx.deps, coordinator, { limit: 30, from: '2025-01-01', to: '2026-09-01' }),
    ).rejects.toMatchObject({ code: 'validation_failed', reason: 'range_too_long' });
    await expect(
      listReports(ctx.deps, coordinator, { limit: 30, from: '2026-09-02', to: '2026-09-01' }),
    ).rejects.toMatchObject({ code: 'validation_failed', reason: 'invalid_range' });
    await expect(
      listReports(ctx.deps, coordinator, { limit: 30, from: '2025-09-01', to: '2026-09-01' }),
    ).resolves.toMatchObject({ reports: [] });
  });

  describe('詳細', () => {
    it('他のスタッフの記録をコーディネーターが読むと記録し、保存し直した回数を返す', async () => {
      const saved = await saveDailyReport(ctx.deps, staff, daily());
      await saveDailyReport(ctx.deps, staff, daily({ reportId: saved.id, inputText: '直した' }));
      const { report, timeZone } = await getReportDetail(ctx.deps, coordinator, saved.id);
      expect(timeZone).toBe('Asia/Tokyo');
      expect(report).toMatchObject({
        kind: 'daily_report',
        staffName: '山田 太郎',
        customerName: '佐藤 花子',
        rowVersion: 2,
        revisionCount: 1,
        riskRating: 1,
        content: { inputText: '直した', internalText: '社内向けの文' },
      });
      expect(ctx.appLog.byAction('report.detail.viewed')[0]).toMatchObject({
        targetStaffId: staff.staffId,
      });
    });

    it('一般スタッフは本人の記録だけ(他人は 403 + SECURITY)。無い記録は 404', async () => {
      const mine = await saveAccidentReport(ctx.deps, staff, {
        customerId,
        reportType: '事故報告',
        ...ACCIDENT_BODY,
      });
      const theirs = await saveDailyReport(ctx.deps, other, daily());
      await expect(getReportDetail(ctx.deps, staff, mine.id)).resolves.toMatchObject({
        report: { kind: 'accident', content: { location: '公園' } },
      });
      expect(ctx.appLog.byAction('report.detail.viewed')).toHaveLength(0);
      await expect(getReportDetail(ctx.deps, staff, theirs.id)).rejects.toMatchObject({ code: 'forbidden' });
      expect(ctx.appLog.byAction('report.detail.view_denied')[0]?.level).toBe('SECURITY');
      await expect(
        getReportDetail(ctx.deps, coordinator, '00000000-0000-7000-8000-000000000000'),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('CSV', () => {
    it('日報のシートは日報だけ、事故報告のシートは事故報告とヒヤリハット。顧客IDは取込元のID', async () => {
      await saveDailyReport(ctx.deps, staff, daily());
      await saveAccidentReport(ctx.deps, other, { customerId, reportType: '事故報告', ...ACCIDENT_BODY });
      await saveAccidentReport(ctx.deps, other, { customerId, reportType: 'ヒヤリハット', ...ACCIDENT_BODY });
      const dailyExport = await exportReports(ctx.deps, coordinator, 'daily', {});
      const dailyRows = await collect(dailyExport.rows());
      expect(dailyRows.map((r) => [r.kind, r.customerExternalId, r.timestamp])).toEqual([
        ['daily_report', 'R-001', '2026/09/20 09:00:00'],
      ]);
      const accident = await collect((await exportReports(ctx.deps, coordinator, 'accident', {})).rows());
      expect(accident.map((r) => r.kind).sort()).toEqual(['accident', 'near_miss']);
      const onlyNearMiss = await collect(
        (await exportReports(ctx.deps, coordinator, 'accident', { kind: 'near_miss' })).rows(),
      );
      expect(onlyNearMiss.map((r) => r.kind)).toEqual(['near_miss']);
      const logs = ctx.appLog.byAction('report.list.exported');
      expect(logs).toHaveLength(3);
      expect(logs[0]).toMatchObject({
        level: 'SECURITY',
        details: { sheet: 'daily', kinds: ['daily_report'] },
      });
    });

    it('一般スタッフは書き出せない', async () => {
      await expect(exportReports(ctx.deps, staff, 'daily', {})).rejects.toMatchObject({ code: 'forbidden' });
      expect(ctx.appLog.byAction('report.list.exported')).toHaveLength(0);
    });

    it('500件を超えても全件を順に書き出す', async () => {
      // 保存の usecase は1件ずつ遅いので、1件保存してから同じ時刻の行を直接増やす(同じ時刻でも抜けないこと)
      await saveDailyReport(ctx.deps, staff, daily({ reportDate: '2026-09-10' }));
      const records = ctx.data().careRecords;
      const first = records[0];
      if (!first) throw new Error('保存できませんでした');
      for (let i = 1; i < 1001; i++) {
        records.push({
          ...structuredClone(first),
          id: `0190a000-0000-7000-8000-${String(i).padStart(12, '0')}`,
        });
      }
      const rows = await collect((await exportReports(ctx.deps, coordinator, 'daily', {})).rows());
      expect(rows).toHaveLength(1001);
      expect(new Set(rows.map((r) => r.id)).size).toBe(1001);
    });
  });
});

describe('一覧の抜粋・時刻', () => {
  const dailyBody = (internalText: string, inputText = 'メモ', startTime = '', endTime = '') => ({
    recordType: 'daily_report' as const,
    content: { startTime, endTime, inputText, internalText, customerText: '' },
  });

  it('改行・空白をまとめ、長ければ切って「…」を付ける。空なら書いたメモ', () => {
    expect(reportExcerpt(dailyBody('一行目\n\n  二行目'))).toBe('一行目 二行目');
    expect(reportExcerpt(dailyBody('あ'.repeat(61)))).toBe(`${'あ'.repeat(60)}…`);
    expect(reportExcerpt(dailyBody('😀'.repeat(3)), 2)).toBe('😀😀…');
    expect(reportExcerpt(dailyBody('  ', '元のメモ'))).toBe('元のメモ');
  });

  it('日報は開始〜終了(片方ならその時刻)、無ければ記録の時刻', () => {
    expect(reportTimeLabel(dailyBody('', '', '09:00', '12:00'), '09:00')).toBe('09:00〜12:00');
    expect(reportTimeLabel(dailyBody('', '', '09:00', ''), '10:00')).toBe('09:00');
    expect(reportTimeLabel(dailyBody(''), '10:15')).toBe('10:15');
  });
});
