import type { CareRecordBody } from './careRecord';

/** 一覧の抜粋の既定の最大文字数(@katahimo/shared REPORT_EXCERPT_MAX_LENGTH と同じ)。 */
const DEFAULT_EXCERPT_LENGTH = 60;

/**
 * 全員分の一覧に出す本文の抜粋。日報は事務局に送る文、事故報告・ヒヤリハットは事故内容を使い、空なら書いたメモ。
 * 改行・連続する空白は1つの空白にまとめ、長ければ max 文字(サロゲートペアは1文字)で切って「…」を付ける。
 */
export function reportExcerpt(body: CareRecordBody, max = DEFAULT_EXCERPT_LENGTH): string {
  const main = body.recordType === 'daily_report' ? body.content.internalText : body.content.accidentContent;
  const source = main.trim() ? main : body.content.inputText;
  const flat = source.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : flat;
}

/**
 * 一覧の時刻の表示。日報は入力された「開始〜終了」(片方だけならその時刻)、入力が無い日報と事故報告は
 * 記録の時刻(recordedHHmm)。
 */
export function reportTimeLabel(body: CareRecordBody, recordedHHmm: string): string {
  if (body.recordType !== 'daily_report') return recordedHHmm;
  const { startTime, endTime } = body.content;
  if (startTime && endTime) return `${startTime}〜${endTime}`;
  return startTime || endTime || recordedHHmm;
}
