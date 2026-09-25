import { describe, expect, it } from 'vitest';
import { parseStaffMasterCsv } from './parse';

const HASH = 'b'.repeat(64);
const header =
  'No,氏名,カナ,電話,メール,住所,入社日,退職日,備考,パスワード,管理者,LW_ID,サブメール,Token,Expiry';

describe('parseStaffMasterCsv', () => {
  it('GAS版スタッフ台帳の列位置(B/E/H/J/K/M)を意味のある項目に変換する', () => {
    const csv = [
      `﻿${header}`,
      `1,佐藤 花子,サトウ,090,hanako@gmail.com,,2020/4/1,,,${HASH},1,lw1,hanako@cutest.biz,tok,2026/01/01`,
      `2,鈴木 次郎,,,jiro@gmail.com,,,2026/3/31,,plain,,,chat-id-123`,
      ',,,,,,,,,,,,',
    ].join('\n');
    const parsed = parseStaffMasterCsv(csv);
    expect(parsed.rows).toEqual([
      {
        rowNumber: 2,
        name: '佐藤 花子',
        email: 'hanako@gmail.com',
        altEmail: 'hanako@cutest.biz',
        password: HASH,
        isAdmin: true,
        retiredOn: null,
      },
      {
        rowNumber: 3,
        name: '鈴木 次郎',
        email: 'jiro@gmail.com',
        altEmail: null,
        password: 'plain',
        isAdmin: false,
        retiredOn: '2026-03-31',
      },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it('解釈できない退職日は警告を出して空として扱う', () => {
    const parsed = parseStaffMasterCsv(`${header}\n1,A,,,a@example.com,,,未定,,,,,`);
    expect(parsed.rows[0]?.retiredOn).toBeNull();
    expect(parsed.warnings).toHaveLength(1);
  });
});
