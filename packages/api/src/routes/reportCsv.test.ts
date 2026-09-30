import type { ReportExportRow } from '@katahimo/core/usecases';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportFailedMarker } from '../http/csv';
import { REPORT_CSV_HEADERS, writeReportCsv } from './reportCsv';

const base = {
  id: '0190a000-0000-7000-8000-000000000001',
  occurredAt: '2026-09-20T00:00:00.000Z',
  date: '2026-09-20',
  time: '09:00〜12:00',
  updatedAt: '2026-09-20T05:00:00.000Z',
  createdAt: '2026-09-20T05:00:00.000Z',
  staffId: '0190a000-0000-7000-8000-00000000000a',
  staffName: '山田 太郎',
  customerId: '0190a000-0000-7000-8000-00000000000b',
  customerName: '佐藤 花子',
  timestamp: '2026/09/20 09:00:00',
  updatedTimestamp: '2026/09/20 14:00:00',
  customerExternalId: 'R-001',
};

const dailyRow: ReportExportRow = {
  ...base,
  kind: 'daily_report',
  riskRating: 2,
  esRating: null,
  content: {
    startTime: '09:00',
    endTime: '12:00',
    inputText: '=SUM(A1)',
    internalText: '一行目\n二行目',
    customerText: '「元気」でした, とても',
  },
};

const accidentRow: ReportExportRow = {
  ...base,
  kind: 'near_miss',
  riskRating: null,
  esRating: null,
  staffName: null,
  content: {
    targetName: '佐藤 はな',
    targetDob: '2022/04/01',
    occurrenceTime: '10:30頃',
    location: '公園',
    accidentContent: '転びそうになった',
    situation: '走っていた',
    immediateResponse: '声をかけた',
    parentCorrespondence: 'お迎え時に説明',
    diagnosisTreatment: '',
    prevention: '見守り',
    inputText: 'ヒヤッとした',
  },
};

class Sink {
  chunks: string[] = [];
  aborted = false;
  async write(chunk: string) {
    this.chunks.push(chunk);
  }
  get lines() {
    return this.chunks.join('').slice(1).trimEnd().split('\r\n');
  }
}

async function* batchesOf(...batches: ReportExportRow[][]) {
  for (const b of batches) yield b;
}

describe('日報・事故報告の CSV', () => {
  afterEach(() => vi.restoreAllMocks());

  it('日報は「日報」シートと同じ並び(12列+最終更新)。式・改行・カンマは安全に書く', async () => {
    const sink = new Sink();
    await writeReportCsv(sink, 'daily', batchesOf([dailyRow]), 'req-1');
    expect(sink.chunks[0]?.startsWith('﻿日時,開始時刻,終了時刻,スタッフ,顧客ID,お客様')).toBe(true);
    expect(REPORT_CSV_HEADERS.daily).toHaveLength(13);
    const text = sink.chunks.join('');
    expect(text).toContain(
      `2026/09/20 09:00:00,09:00,12:00,山田 太郎,R-001,佐藤 花子,'=SUM(A1),"一行目\n二行目","「元気」でした, とても",2,,${base.id},2026/09/20 14:00:00\r\n`,
    );
  });

  it('事故報告は「事故報告」シートと同じ並び(17列+最終更新)で、種別の列に事故報告/ヒヤリハット', async () => {
    const sink = new Sink();
    await writeReportCsv(sink, 'accident', batchesOf([accidentRow]), null);
    const [header, row] = sink.lines;
    expect(header?.split(',')).toHaveLength(18);
    expect(header?.split(',').slice(0, 6)).toEqual([
      '日時',
      '報告者',
      '顧客ID',
      'お客様',
      '対象児童名',
      '生年月日',
    ]);
    const cells = row?.split(',') ?? [];
    expect(cells[1]).toBe('(削除されたスタッフ)');
    expect(cells[15]).toBe('ヒヤリハット');
    expect(cells[16]).toBe(base.id);
  });

  it('途中で失敗したら ERROR を残し、最後の行に失敗の印を書く。切られたら続きを読まない', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = new Sink();
    async function* failing() {
      yield [dailyRow];
      throw new Error('DB が落ちた');
    }
    await writeReportCsv(sink, 'daily', failing(), 'req-2');
    expect(sink.lines.at(-1)).toBe(exportFailedMarker('req-2'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('日報・事故報告の CSV'));

    const cut = new Sink();
    let read = 0;
    async function* endless() {
      for (;;) {
        read++;
        if (read === 2) cut.aborted = true;
        yield [dailyRow];
      }
    }
    await writeReportCsv(cut, 'daily', endless(), null);
    expect(read).toBe(2);
    expect(cut.chunks).toHaveLength(2);
  });
});
