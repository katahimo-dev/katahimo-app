import { describe, expect, it } from 'vitest';
import {
  appendStaffSurname,
  createInitialForm,
  generateButtonLabel,
  isDailyDraftApiError,
  isSaveButtonShown,
  isSavedAndClean,
  type ReportFormState,
  reportFormReducer,
} from './reportForm';

const initial = (): ReportFormState =>
  createInitialForm({
    today: '2026-09-25',
    lastStart: { hour: '09', minute: '30' },
    lastAccidentTime: '10:05',
  });

describe('開いたとき(GAS版 openModal)', () => {
  it('前回の始めた時間 + 2時間、前回の起きた時間、日報モード', () => {
    const f = initial();
    expect(f.mode).toBe('daily');
    expect(f.end).toEqual({ hour: '11', minute: '30' });
    expect(f.accident.occurrenceTime).toBe('10:05');
    expect(f.saved.daily).toEqual({ reportId: null, isDirty: true });
  });
});

describe('reportFormReducer', () => {
  it('始めた時間を変えると終わった時間も2時間後になる', () => {
    const f = reportFormReducer(initial(), { type: 'setStart', start: { hour: '13', minute: '45' } });
    expect(f.end).toEqual({ hour: '15', minute: '45' });
  });

  it('★1をもう一度押すと未評価に戻る', () => {
    let f = reportFormReducer(initial(), { type: 'setRating', rating: 'risk', score: 1 });
    expect(f.ratings.risk).toBe(1);
    f = reportFormReducer(f, { type: 'setRating', rating: 'risk', score: 1 });
    expect(f.ratings.risk).toBe(0);
    f = reportFormReducer(f, { type: 'setRating', rating: 'risk', score: 3 });
    f = reportFormReducer(f, { type: 'setRating', rating: 'risk', score: 3 });
    expect(f.ratings.risk).toBe(3);
  });

  it('音声入力の文は改行でつなぐ', () => {
    let f = reportFormReducer(initial(), { type: 'appendMemo', text: 'こんにちは' });
    f = reportFormReducer(f, { type: 'appendMemo', text: '公園へ' });
    expect(f.memo).toBe('こんにちは\n公園へ');
  });

  it('お子様を選ぶと事故報告書の名前・生年月日に入る。選び直さないと消える', () => {
    let f = reportFormReducer(initial(), {
      type: 'selectFamily',
      index: '0',
      member: { name: '田中 ゆい', dob: '2023/04/12' },
    });
    expect(f.accident.targetName).toBe('田中 ゆい');
    f = reportFormReducer(f, { type: 'selectFamily', index: '', member: null });
    expect(f.accident).toMatchObject({ targetName: '', targetDob: '' });
  });

  it('保存したら「✅ 保存しました」、変えたら「保存する」に戻る(そのモードだけ)', () => {
    let f = reportFormReducer(initial(), { type: 'saved', mode: 'daily', reportId: 'r1' });
    expect(isSavedAndClean(f)).toBe(true);
    f = reportFormReducer(f, { type: 'switchMode', mode: 'accident' });
    expect(isSavedAndClean(f)).toBe(false);
    f = reportFormReducer(f, { type: 'markDirty' });
    f = reportFormReducer(f, { type: 'switchMode', mode: 'daily' });
    expect(isSavedAndClean(f)).toBe(true);
    f = reportFormReducer(f, { type: 'markDirty' });
    expect(isSavedAndClean(f)).toBe(false);
    expect(f.saved.daily.reportId).toBe('r1');
  });

  it('モードを切り替えると、結果欄は中身があるかで出し直す(GAS版 switchMode)', () => {
    let f = reportFormReducer(initial(), {
      type: 'dailyGenerated',
      internal: '事務局',
      customer: '保護者',
      warnings: null,
    });
    expect(isSaveButtonShown(f)).toBe(true);
    f = reportFormReducer(f, { type: 'switchMode', mode: 'accident' });
    // 起きた時間(前回値)だけでは下書きありとみなさない
    expect(isSaveButtonShown(f)).toBe(false);
    expect(generateButtonLabel(f)).toBe('✨ AIに報告書の下書きを作ってもらう');
    f = reportFormReducer(f, { type: 'switchMode', mode: 'daily' });
    expect(isSaveButtonShown(f)).toBe(true);
    expect(generateButtonLabel(f)).toBe('もう一度AIに書いてもらう');
  });

  it('AI生成ボタンの文言は結果の中身で決める', () => {
    const f = initial();
    expect(generateButtonLabel(f)).toBe('✨ AIに日報を書いてもらう');
    expect(generateButtonLabel({ ...f, internalText: '  ' })).toBe('✨ AIに日報を書いてもらう');
    expect(
      generateButtonLabel({ ...f, mode: 'accident', accident: { ...f.accident, accidentContent: '転倒' } }),
    ).toBe('もう一度AIに書いてもらう');
  });
});

describe('appendStaffSurname(保護者に送る文の最後に苗字)', () => {
  it('空白(全角も)で区切った最初の部分', () => {
    expect(appendStaffSurname('ありがとうございました。', '佐藤 美咲')).toBe(
      'ありがとうございました。\n\n佐藤',
    );
    expect(appendStaffSurname('文', '鈴木　一郎')).toBe('文\n\n鈴木');
    expect(appendStaffSurname('文', '山田')).toBe('文\n\n山田');
  });
  it('名前が無ければそのまま', () => {
    expect(appendStaffSurname('文', '')).toBe('文');
  });
});

describe('isDailyDraftApiError', () => {
  it('API Error / API Key Missing は失敗', () => {
    expect(isDailyDraftApiError(['API Key Missing'])).toBe(true);
    expect(isDailyDraftApiError(['API Error'])).toBe(true);
    expect(isDailyDraftApiError(['終わった時間'])).toBe(false);
    expect(isDailyDraftApiError([])).toBe(false);
  });
});
