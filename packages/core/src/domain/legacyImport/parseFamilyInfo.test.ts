import { describe, expect, it } from 'vitest';
import { parseFamilyInfo } from './parseFamilyInfo';

/**
 * ここでのテストケースは全て、実際のRESERVA CSVサンプル(01_GAS/Kokyaku_202601191958_1_dummy.csv)
 * の「世帯全員の情報」欄から抜き出した実データ。
 *
 * 移植時、この関数の移植元(gas-childcare-visit-app/CsvImport.js)をそのままNode上で実行し、
 * サンプルCSV全398行を突き合わせて本実装との出力差分がゼロであることを確認済み
 * (CLAUDE.mdの「Logic verification」に基づく検証手法)。ここでは代表的なパターンを
 * 回帰テストとして固定する。
 */
describe('parseFamilyInfo', () => {
  it('「氏名 日付 情報」形式(ドット区切り日付)を複数人分パースする', () => {
    const raw =
      '桃太郎 1990.1.28 在东京工作\n金太郎 2019.1.19 在horizon上学校\n浦島太郎 2020.6.20 在shirayuri上幼稚园';
    expect(parseFamilyInfo(raw)).toEqual([
      { name: '桃太郎', dob: '1990/1/28', info: '在东京工作' },
      { name: '金太郎', dob: '2019/1/19', info: '在horizon上学校' },
      { name: '浦島太郎', dob: '2020/6/20', info: '在shirayuri上幼稚园' },
    ]);
  });

  it('和暦「年月日」形式の日付を複数人分パースする', () => {
    const raw = '一寸法師 1990年2月21日 大学助教\nかぐや姫 1997年3月27日 学生\n乙姫 2025年9月6日 新生児';
    expect(parseFamilyInfo(raw)).toEqual([
      { name: '一寸法師', dob: '1990/2/21', info: '大学助教' },
      { name: 'かぐや姫', dob: '1997/3/27', info: '学生' },
      { name: '乙姫', dob: '2025/9/6', info: '新生児' },
    ]);
  });

  it('情報欄が複数語(職業+アレルギー情報)ある場合、スペース区切りで結合する', () => {
    const raw =
      '織姫 1990.9.13 会社員 アレルギーなし\n彦星 1993.02.15 主婦 アレルギーなし\n花咲か爺 2021.02.13 主婦 アレルギーなし';
    expect(parseFamilyInfo(raw)).toEqual([
      { name: '織姫', dob: '1990/9/13', info: '会社員 アレルギーなし' },
      { name: '彦星', dob: '1993/02/15', info: '主婦 アレルギーなし' },
      { name: '花咲か爺', dob: '2021/02/13', info: '主婦 アレルギーなし' },
    ]);
  });

  it('8桁西暦かつ情報欄が無い行(子どもの生年月日のみ)を空infoでパースする', () => {
    const raw =
      'こぶとり爺 19860921 自営業\n笠地蔵 19910926 パート\nわらしべ長者 20210619\n瓜子姫 20230812\n鉢かづき姫 20250314';
    expect(parseFamilyInfo(raw)).toEqual([
      { name: 'こぶとり爺', dob: '1986/09/21', info: '自営業' },
      { name: '笠地蔵', dob: '1991/09/26', info: 'パート' },
      { name: 'わらしべ長者', dob: '2021/06/19', info: '' },
      { name: '瓜子姫', dob: '2023/08/12', info: '' },
      { name: '鉢かづき姫', dob: '2025/03/14', info: '' },
    ]);
  });

  it('空文字は空配列を返す', () => {
    expect(parseFamilyInfo('')).toEqual([]);
  });
});
