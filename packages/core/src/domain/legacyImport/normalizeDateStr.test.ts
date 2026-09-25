import { describe, expect, it } from 'vitest';
import { normalizeDateStr } from './normalizeDateStr';

describe('normalizeDateStr', () => {
  it('8桁西暦を YYYY/MM/DD に変換する', () => {
    expect(normalizeDateStr('19860921')).toBe('1986/09/21');
  });

  it('和暦(漢字)を西暦に変換する', () => {
    expect(normalizeDateStr('昭和59年5月9日')).toBe('1984/5/9');
    expect(normalizeDateStr('平成5年1月14日')).toBe('1993/1/14');
    expect(normalizeDateStr('令和7年7月17日')).toBe('2025/7/17');
    expect(normalizeDateStr('令和元年12月1日')).toBe('2019/12/1');
  });

  it('元号略記(アルファベット、大文字小文字を区別しない)を西暦に変換する', () => {
    expect(normalizeDateStr('H1.10.16')).toBe('1989/10/16');
    expect(normalizeDateStr('h5.12.29')).toBe('1993/12/29');
    expect(normalizeDateStr('r3.5.14')).toBe('2021/5/14');
    expect(normalizeDateStr('H4/8/5')).toBe('1992/8/5');
  });

  it('和暦(漢字+ドット区切り)を西暦に変換する', () => {
    expect(normalizeDateStr('令和5.9.25')).toBe('2023/9/25');
    expect(normalizeDateStr('平成5.1.14')).toBe('1993/1/14');
  });

  it('西暦+年月日表記を YYYY/M/D に変換する', () => {
    expect(normalizeDateStr('1961年9月2日')).toBe('1961/9/2');
  });

  it('末尾の「生」を除去してから判定する', () => {
    expect(normalizeDateStr('H4.8.5生')).toBe('1992/8/5');
  });

  it('区切り文字違いの西暦表記を "/" に統一する', () => {
    expect(normalizeDateStr('1990.1.28')).toBe('1990/1/28');
    expect(normalizeDateStr('1990-1-28')).toBe('1990/1/28');
    expect(normalizeDateStr('1990/1/28')).toBe('1990/1/28');
  });

  it('空文字はそのまま空文字を返す', () => {
    expect(normalizeDateStr('')).toBe('');
  });
});
