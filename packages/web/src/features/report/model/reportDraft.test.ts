import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../../lib/memoryStorage.test-helper';
import {
  applyDraftToForm,
  buildDraftSnapshot,
  clearPendingDraft,
  draftRestoredMessage,
  readPendingDraft,
  writePendingDraft,
} from './reportDraft';
import { createInitialForm, type ReportFormState } from './reportForm';

const customer = { id: '00000000-0000-4000-8000-0000000000c1', name: '田中 さくら' };
const NOW = 1_790_000_000_000;

function freshForm(): ReportFormState {
  return createInitialForm({
    today: '2026-09-25',
    lastStart: { hour: '09', minute: '00' },
    lastAccidentTime: '',
  });
}

describe('退避する内容(GAS版 saveReportDraftSnapshot と同じ形)', () => {
  it('日報は事務局・保護者の文を入れる', () => {
    const form: ReportFormState = {
      ...freshForm(),
      memo: '公園で遊んだ',
      start: { hour: '10', minute: '30' },
      end: { hour: '12', minute: '30' },
      internalText: '事務局向け',
      customerText: '保護者向け',
    };
    expect(buildDraftSnapshot(form, customer, 'daily', NOW)).toEqual({
      customerId: customer.id,
      customerName: '田中 さくら',
      mode: 'daily',
      inputText: '公園で遊んだ',
      start: '10:30',
      end: '12:30',
      savedAt: NOW,
      internalResult: '事務局向け',
      customerResult: '保護者向け',
    });
  });

  it('事故は下書きの8項目を入れる(お子様の名前・生年月日は入れない)', () => {
    const form = freshForm();
    const snapshot = buildDraftSnapshot(
      { ...form, accident: { ...form.accident, targetName: 'ゆい', accidentContent: '転倒' } },
      customer,
      'accident',
      NOW,
    );
    expect(snapshot.internalResult).toBeUndefined();
    expect(snapshot.accident).toEqual({
      occurrenceTime: '',
      location: '',
      accidentContent: '転倒',
      situation: '',
      immediateResponse: '',
      parentCorrespondence: '',
      diagnosisTreatment: '',
      prevention: '',
    });
  });
});

const SCOPE = { tenantId: 't1', staffId: 's1' };
const KEY = 'pending_report_draft@t1/s1';

describe('保存・読み込み', () => {
  it('書いて読める。消したら null', () => {
    const storage = createMemoryStorage();
    writePendingDraft(buildDraftSnapshot(freshForm(), customer, 'daily', NOW), SCOPE, storage);
    expect(Object.keys(storage.snapshot())).toEqual([KEY]);
    expect(readPendingDraft(SCOPE, storage)?.customerId).toBe(customer.id);
    clearPendingDraft(SCOPE, storage);
    expect(readPendingDraft(SCOPE, storage)).toBeNull();
  });

  it('ほかのスタッフ・ほかの法人の書きかけは見えない', () => {
    const storage = createMemoryStorage();
    writePendingDraft(buildDraftSnapshot(freshForm(), customer, 'daily', NOW), SCOPE, storage);
    expect(readPendingDraft({ tenantId: 't1', staffId: 's2' }, storage)).toBeNull();
    expect(readPendingDraft({ tenantId: 't2', staffId: 's1' }, storage)).toBeNull();
  });

  it('GAS版で書いた形(数字のお客様ID)も読める', () => {
    const storage = createMemoryStorage({
      [KEY]: JSON.stringify({
        customerId: 12,
        customerName: 'A',
        mode: 'daily',
        inputText: 'x',
      }),
    });
    expect(readPendingDraft(SCOPE, storage)?.customerId).toBe('12');
  });

  it('壊れていたら消して null', () => {
    const storage = createMemoryStorage({ [KEY]: '{broken' });
    expect(readPendingDraft(SCOPE, storage)).toBeNull();
    expect(storage.snapshot()).toEqual({});
    const storage2 = createMemoryStorage({ [KEY]: JSON.stringify({ mode: 'daily' }) });
    expect(readPendingDraft(SCOPE, storage2)).toBeNull();
    expect(storage2.snapshot()).toEqual({});
  });
});

describe('戻す(GAS版 applyPendingReportDraft_)', () => {
  it('日報: メモ・時刻・結果を戻し、結果欄と保存ボタンを出す', () => {
    const restored = applyDraftToForm(freshForm(), {
      customerId: customer.id,
      customerName: '田中 さくら',
      mode: 'daily',
      inputText: 'メモ',
      start: '10:15',
      end: '12:45',
      internalResult: '事務局',
      customerResult: '',
    });
    expect(restored.mode).toBe('daily');
    expect(restored.memo).toBe('メモ');
    expect(restored.start).toEqual({ hour: '10', minute: '15' });
    expect(restored.end).toEqual({ hour: '12', minute: '45' });
    expect(restored.internalText).toBe('事務局');
    expect(restored.dailyResultShown).toBe(true);
  });

  it('日報: 結果が空なら結果欄は出さない', () => {
    const restored = applyDraftToForm(freshForm(), { customerId: 'x', mode: 'daily', inputText: 'メモ' });
    expect(restored.dailyResultShown).toBe(false);
    expect(restored.memo).toBe('メモ');
  });

  it('事故: 終わった時間は戻さず、下書きを戻して下書き欄を出す', () => {
    const form = freshForm();
    const restored = applyDraftToForm(form, {
      customerId: 'x',
      mode: 'accident',
      inputText: 'つまずいた',
      start: '14:00',
      end: '23:45',
      accident: { occurrenceTime: '14:05', accidentContent: '転倒' },
    });
    expect(restored.mode).toBe('accident');
    expect(restored.start).toEqual({ hour: '14', minute: '00' });
    expect(restored.end).toEqual(form.end);
    expect(restored.accident.occurrenceTime).toBe('14:05');
    expect(restored.accident.accidentContent).toBe('転倒');
    expect(restored.accident.location).toBe('');
    expect(restored.accidentResultShown).toBe(true);
  });

  it('お知らせの文', () => {
    expect(draftRestoredMessage({ customerId: 'x', customerName: '田中 さくら' })).toBe(
      '前回の田中 さくら様の日報が保存されていません。続きを書いて保存するか、要らなければ「破棄する」を押してください',
    );
  });
});
