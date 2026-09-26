import { describe, expect, it } from 'vitest';
import { formatGrants, parseSchemaDocs, simplifyDefinition } from './tableDoc';

const SOURCE = `
/**
 * 1日の入れ物。
 * - 楽観的排他の単位。
 */
export const attendanceDays = pgTable(
  'attendance_days',
  {
    tenantId: tenantIdColumn(),
    /** 表示名(複数行の
     * 説明)。 */
    displayName: text().notNull(),
    // 行コメントは説明に使わない
    remarks: text(),
  },
  (t) => [],
);
`;

describe('テーブル定義書の生成', () => {
  it('テーブルと列の JSDoc を読む(箇条書きは改行を残す、行コメントは使わない)', () => {
    expect(parseSchemaDocs(SOURCE)).toEqual({
      attendance_days: {
        doc: '1日の入れ物。\n- 楽観的排他の単位。',
        columns: { display_name: '表示名(複数行の説明)。' },
      },
    });
  });

  it('制約の定義を読みやすくする', () => {
    expect(simplifyDefinition("CHECK ((status = ANY (ARRAY['open'::text, 'locked'::text])))")).toBe(
      "CHECK ((status IN ('open', 'locked')))",
    );
  });

  it('権限は表の権限の後に列ごとの権限を足す(無ければ —)', () => {
    expect(
      formatGrants('INSERT,SELECT', { UPDATE: ['cancelled_at', 'row_version'], REFERENCES: ['id'] }),
    ).toBe('INSERT,SELECT,REFERENCES(id),UPDATE(cancelled_at, row_version)');
    expect(formatGrants('SELECT', undefined)).toBe('SELECT');
    expect(formatGrants(undefined, { UPDATE: ['last_used_at'] })).toBe('UPDATE(last_used_at)');
    expect(formatGrants(undefined, undefined)).toBe('—');
  });
});
