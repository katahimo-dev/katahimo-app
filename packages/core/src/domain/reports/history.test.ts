import { describe, expect, it } from 'vitest';
import { buildAccidentHistoryInternalText } from './history';
import type { AccidentReportContent } from './types';

const baseContent: AccidentReportContent = {
  targetName: '太郎',
  targetDob: '2020/01/01',
  occurrenceTime: '10時頃',
  location: 'リビング',
  accidentContent: '転倒による打撲',
  situation: '遊んでいて転んだ',
  immediateResponse: '冷却した',
  parentCorrespondence: '電話連絡済み',
  diagnosisTreatment: '診療前',
  prevention: '見守り強化',
  inputText: '元メモ',
};

describe('buildAccidentHistoryInternalText', () => {
  it('GAS版getCustomerReportsのinternalText組み立てと同じ並び順・見出しで結合する', () => {
    expect(buildAccidentHistoryInternalText(baseContent)).toBe(
      [
        '【発生時間】10時頃',
        '【場所】リビング',
        '【状況】\n遊んでいて転んだ',
        '【事故内容】\n転倒による打撲',
        '【応急処置】\n冷却した',
        '【受診・治療】\n診療前',
        '【再発防止策】\n見守り強化',
      ].join('\n\n'),
    );
  });

  it('空文字の項目は見出しごと省略する', () => {
    const empty: AccidentReportContent = {
      targetName: '',
      targetDob: '',
      occurrenceTime: '',
      location: '',
      accidentContent: '',
      situation: '',
      immediateResponse: '',
      parentCorrespondence: '',
      diagnosisTreatment: '',
      prevention: '',
      inputText: '',
    };
    expect(buildAccidentHistoryInternalText(empty)).toBe('');
  });
});
