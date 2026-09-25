import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseReservaCsv } from './parse';

/**
 * __fixtures__/Kokyaku_202601191958_1_dummy.csv(旧 C001-cutest-internal の 01_GAS/ から複製)は実際のRESERVA(外部予約システム)エクスポート形式の
 * サンプル(UTF-16LE・タブ区切り・ダミー顧客398件)。このテストはハードコードした期待値ではなく、
 * 実ファイルを実際にデコード・パースして検証する(fixtureを別途用意せず、本物の形式的な癖
 * ―BOM・タブ区切り・複数行にまたがる引用符付きフィールド・Excelシリアル日時―を
 * そのまま検証対象にするため)。
 */
const SAMPLE_CSV_PATH = fileURLToPath(
  new URL('./__fixtures__/Kokyaku_202601191958_1_dummy.csv', import.meta.url),
);

describe('parseReservaCsv (実サンプルCSVでの検証)', () => {
  const buffer = readFileSync(SAMPLE_CSV_PATH);
  const rows = parseReservaCsv(buffer);

  it('398件の顧客行を取りこぼしなくパースする', () => {
    expect(rows).toHaveLength(398);
  });

  it('UTF-16LE・BOM・タブ区切りを正しく解釈し、姓名・カナ・メール・電話を取得する', () => {
    const first = rows[0];
    expect(first?.customerId).toBe('59eJwzNDU1NTQ0tAQABzwBnQ');
    expect(first?.familyName).toBe('聖徳');
    expect(first?.givenName).toBe('太子');
    expect(first?.familyNameKana).toBe('ショウトク');
    expect(first?.givenNameKana).toBe('タイシ');
    expect(first?.email).toBe('test@mail.com');
  });

  it('Excelシリアル日時形式の登録日時・最終更新日時をISO8601に変換する', () => {
    const first = rows[0];
    expect(first?.registeredAt).toBe('2025-08-13T13:12:00.000Z');
    expect(first?.externalLastUpdatedAt).toBe('2026-01-01T01:41:00.096Z');
  });

  it('複数行にまたがる「世帯全員の情報」欄(引用符で囲まれた改行入りフィールド)を1顧客分として保持し、parseFamilyInfoで世帯構成員に分解する(子どもの情報を省略しない)', () => {
    const first = rows[0];
    expect(first?.familyInfoRaw).toBe(
      '桃太郎 1990.1.28 在东京工作\n金太郎 2019.1.19 在horizon上学校\n浦島太郎 2020.6.20 在shirayuri上幼稚园',
    );
    expect(first?.familyMembers).toEqual([
      { name: '桃太郎', dob: '1990/1/28', info: '在东京工作' },
      { name: '金太郎', dob: '2019/1/19', info: '在horizon上学校' },
      { name: '浦島太郎', dob: '2020/6/20', info: '在shirayuri上幼稚园' },
    ]);
  });

  it('顧客IDが空の行は存在しない(取込に必須の識別子が全行で取得できている)', () => {
    expect(rows.every((r) => r.customerId.length > 0)).toBe(true);
  });

  it('パスワード列に相当するフィールドを一切保持しない(ReservaCsvRowの型に存在しない)', () => {
    const first = rows[0] as unknown as Record<string, unknown>;
    expect(first).not.toHaveProperty('password');
  });
});
