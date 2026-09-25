import type { CareRecordType } from '../model';
import type { AccidentReportContent, DailyReportContent } from './types';

/** 記録の本文の版(body_schema_ver)。本文の形を変えるときに上げ、読み出し側で古い版を変換する。 */
export const CARE_RECORD_BODY_SCHEMA_VERSION = 1;

export type CareRecordBody =
  | { recordType: 'daily_report'; content: DailyReportContent }
  | { recordType: 'accident' | 'near_miss'; content: AccidentReportContent };

/** 事故報告の種類(GAS版の表記)↔ 記録の種類。 */
export const ACCIDENT_REPORT_TYPES = { accident: '事故報告', near_miss: 'ヒヤリハット' } as const;

export function recordTypeOfAccidentReport(reportType: string): 'accident' | 'near_miss' {
  return reportType === ACCIDENT_REPORT_TYPES.near_miss ? 'near_miss' : 'accident';
}

export function reportTypeLabelOf(recordType: CareRecordType): string {
  return recordType === 'near_miss' ? ACCIDENT_REPORT_TYPES.near_miss : ACCIDENT_REPORT_TYPES.accident;
}

/** 本文(JSON)を読む。版が違えば(将来)ここで今の形に変換する。 */
export function parseCareRecordBody(
  recordType: CareRecordType,
  json: string,
  schemaVersion: number,
): CareRecordBody {
  if (schemaVersion !== CARE_RECORD_BODY_SCHEMA_VERSION) {
    throw new Error(`未対応の記録の本文の版です: ${schemaVersion}`);
  }
  const content = JSON.parse(json);
  return recordType === 'daily_report'
    ? { recordType, content: content as DailyReportContent }
    : { recordType, content: content as AccidentReportContent };
}

/** 「これまでの記録」のページの続きの位置(不透明な文字列。中身は並びの (occurred_at, id))。 */
export function encodeHistoryCursor(cursor: { occurredAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([cursor.occurredAt.toISOString(), cursor.id]), 'utf8').toString(
    'base64url',
  );
}

export function decodeHistoryCursor(value: string): { occurredAt: Date; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null;
    const occurredAt = new Date(parsed[0]);
    if (Number.isNaN(occurredAt.getTime()) || !/^[0-9a-f-]{36}$/.test(parsed[1])) return null;
    return { occurredAt, id: parsed[1] };
  } catch {
    return null;
  }
}
