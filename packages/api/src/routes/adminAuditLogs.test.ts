import type { AuditLogEntryView } from '@katahimo/core/usecases';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportFailedMarker, writeAuditLogCsv } from './adminAuditLogs';

function entry(id: string): AuditLogEntryView {
  return {
    id,
    createdAt: '2026-09-25T01:00:00.000Z',
    level: 'INFO',
    action: 'staff.admin.created',
    actorType: 'staff',
    actorStaffId: null,
    actorName: null,
    targetStaffId: null,
    targetName: null,
    details: { n: 1 },
    ip: null,
    userAgent: '=HYPERLINK("x")',
    requestId: null,
  };
}

class Sink {
  chunks: string[] = [];
  aborted = false;
  async write(chunk: string) {
    this.chunks.push(chunk);
  }
  get text() {
    return this.chunks.join('');
  }
}

describe('操作ログの CSV', () => {
  afterEach(() => vi.restoreAllMocks());

  it("BOM・見出しの後に行を書き、式として動く値は先頭に ' を付ける", async () => {
    const sink = new Sink();
    async function* batches() {
      yield [entry('a')];
    }
    await writeAuditLogCsv(sink, batches(), 'Asia/Tokyo', 'req-1');
    const [header, row] = sink.text.slice(1).split('\r\n');
    expect(sink.text.startsWith('﻿日時,レベル,操作')).toBe(true);
    expect(header?.split(',')).toHaveLength(11);
    expect(row).toContain('2026-09-25 10:00:00,情報,スタッフの登録,staff.admin.created');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('途中で失敗したら ERROR を残し、最後の行に失敗の印(request id つき)を書く', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = new Sink();
    async function* batches() {
      yield [entry('a')];
      throw new Error('DB が落ちた');
    }
    await writeAuditLogCsv(sink, batches(), 'Asia/Tokyo', 'req-2');
    expect(sink.text.trimEnd().split('\r\n').at(-1)).toBe(exportFailedMarker('req-2'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"requestId":"req-2"'));
  });

  it('受け取る側が切ったら続きを読まない', async () => {
    const sink = new Sink();
    let read = 0;
    async function* batches() {
      for (;;) {
        read++;
        if (read === 2) sink.aborted = true;
        yield [entry(String(read))];
      }
    }
    await writeAuditLogCsv(sink, batches(), 'Asia/Tokyo', null);
    expect(read).toBe(2);
    expect(sink.chunks).toHaveLength(2);
  });
});
