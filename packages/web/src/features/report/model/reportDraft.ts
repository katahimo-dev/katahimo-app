import { z } from 'zod';
import {
  type KeyValueStorage,
  readStorage,
  removeStorage,
  STORAGE_KEYS,
  writeStorage,
} from '../../../lib/storage';
import { formatClock, parseClock } from './dateTime';
import type { ReportFormState, ReportMode } from './reportForm';

/**
 * 保存していない日報の退避(GAS版 saveReportDraftSnapshot / applyPendingReportDraft_ /
 * restoreReportDraftIfAny)。入力が変わるたびに localStorage の `pending_report_draft` に書き、
 * 保存に成功したら消す。形はGAS版と同じ(GAS版で書きかけたものもそのまま読める)。
 */
const accidentDraftSchema = z.object({
  occurrenceTime: z.string().optional(),
  location: z.string().optional(),
  accidentContent: z.string().optional(),
  situation: z.string().optional(),
  immediateResponse: z.string().optional(),
  parentCorrespondence: z.string().optional(),
  diagnosisTreatment: z.string().optional(),
  prevention: z.string().optional(),
});

export const pendingReportDraftSchema = z.object({
  customerId: z.union([z.string(), z.number()]).transform(String),
  customerName: z.string().optional(),
  mode: z.string().optional(),
  inputText: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  savedAt: z.number().optional(),
  internalResult: z.string().optional(),
  customerResult: z.string().optional(),
  accident: accidentDraftSchema.optional(),
});
export type PendingReportDraft = z.infer<typeof pendingReportDraftSchema>;

/** いまの入力から退避する内容を作る(mode の結果欄の中身だけを入れる) */
export function buildDraftSnapshot(
  form: ReportFormState,
  customer: { id: string; name: string },
  mode: ReportMode,
  now: number,
): PendingReportDraft {
  const base: PendingReportDraft = {
    customerId: customer.id,
    customerName: customer.name,
    mode,
    inputText: form.memo,
    start: formatClock(form.start),
    end: formatClock(form.end),
    savedAt: now,
  };
  if (mode === 'daily') {
    return { ...base, internalResult: form.internalText, customerResult: form.customerText };
  }
  const a = form.accident;
  return {
    ...base,
    accident: {
      occurrenceTime: a.occurrenceTime,
      location: a.location,
      accidentContent: a.accidentContent,
      situation: a.situation,
      immediateResponse: a.immediateResponse,
      parentCorrespondence: a.parentCorrespondence,
      diagnosisTreatment: a.diagnosisTreatment,
      prevention: a.prevention,
    },
  };
}

export function writePendingDraft(draft: PendingReportDraft, storage?: KeyValueStorage | null) {
  writeStorage(STORAGE_KEYS.pendingReportDraft, JSON.stringify(draft), storage);
}

export function clearPendingDraft(storage?: KeyValueStorage | null) {
  removeStorage(STORAGE_KEYS.pendingReportDraft, storage);
}

/** 退避してある内容を読む。壊れていたら消して null(GAS版と同じ) */
export function readPendingDraft(storage?: KeyValueStorage | null): PendingReportDraft | null {
  const raw = readStorage(STORAGE_KEYS.pendingReportDraft, storage);
  if (!raw) return null;
  try {
    const parsed = pendingReportDraftSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // 下で消す
  }
  clearPendingDraft(storage);
  return null;
}

/**
 * 退避してあった内容を、開いたばかりのダイアログの状態に戻す(GAS版 applyPendingReportDraft_)。
 * 日付・種類・星・対象のお子様は退避していないので戻さない(GAS版と同じ)。
 */
export function applyDraftToForm(form: ReportFormState, draft: PendingReportDraft): ReportFormState {
  const mode: ReportMode = draft.mode === 'accident' ? 'accident' : 'daily';
  const start = parseClock(draft.start);
  const end = parseClock(draft.end);
  let next: ReportFormState = {
    ...form,
    mode,
    memo: draft.inputText || '',
    start: { hour: start.hour ?? form.start.hour, minute: start.minute ?? form.start.minute },
  };
  if (mode === 'daily') {
    next = { ...next, end: { hour: end.hour ?? form.end.hour, minute: end.minute ?? form.end.minute } };
  }
  // 結果欄は、まず switchMode と同じ判定で出し分ける
  next = {
    ...next,
    dailyResultShown: mode === 'daily' ? next.internalText !== '' : next.dailyResultShown,
    accidentResultShown:
      mode === 'accident' ? next.accident.accidentContent.trim() !== '' : next.accidentResultShown,
  };
  if (mode === 'daily' && (draft.internalResult || draft.customerResult)) {
    next = {
      ...next,
      internalText: draft.internalResult || '',
      customerText: draft.customerResult || '',
      dailyResultShown: true,
    };
  } else if (mode === 'accident' && draft.accident) {
    const a = draft.accident;
    next = {
      ...next,
      accident: {
        ...next.accident,
        occurrenceTime: a.occurrenceTime || '',
        location: a.location || '',
        accidentContent: a.accidentContent || '',
        situation: a.situation || '',
        immediateResponse: a.immediateResponse || '',
        parentCorrespondence: a.parentCorrespondence || '',
        diagnosisTreatment: a.diagnosisTreatment || '',
        prevention: a.prevention || '',
      },
      accidentResultShown: true,
    };
  }
  return next;
}

/** 戻したときのお知らせ(赤。「閉じる」まで消えない) */
export function draftRestoredMessage(draft: PendingReportDraft): string {
  return `前回の${draft.customerName || ''}様の日報が保存されていません。続きを書いて保存してください`;
}
