import { DomainError, errorMessageOf, errorStackOf } from '@katahimo/core/domain';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';
import { mapDatabaseError } from './errors';

/** postgres.js のエラーの形(drizzle は cause に包む)。 */
const pgError = (code: string, constraint?: string) => ({
  message: 'Failed query',
  cause: { code, ...(constraint ? { constraint_name: constraint } : {}) },
});

describe('mapDatabaseError', () => {
  it('締めた月・確定済みの記録は locked、EXCLUDE・ログインID・AIプロンプトの版・日報AIのマスターのキーの重複は conflict', () => {
    expect(mapDatabaseError(pgError('KH001'))).toMatchObject({ code: 'locked', reason: 'period_locked' });
    expect(mapDatabaseError(pgError('KH002'))).toMatchObject({ code: 'locked', reason: 'record_locked' });
    expect(mapDatabaseError(pgError('22003'))).toMatchObject({
      code: 'validation_failed',
      reason: 'out_of_range',
    });
    expect(mapDatabaseError(pgError('KH003'))).toMatchObject({
      code: 'conflict',
      reason: 'already_cancelled',
    });
    expect(mapDatabaseError(pgError('KH004'))).toMatchObject({
      code: 'conflict',
      reason: 'record_not_draft',
    });
    expect(
      mapDatabaseError(pgError('23P01', 'reservation_assignments_tenant_id_staff_id_period_excl')),
    ).toMatchObject({ code: 'conflict' });
    expect(mapDatabaseError(pgError('23505', 'staff_login_emails_pkey'))).toMatchObject({ code: 'conflict' });
    const prompt = mapDatabaseError(pgError('23505', 'ai_prompt_revisions_tenant_id_key_revision_key'));
    expect(prompt).toBeInstanceOf(DomainError);
    expect(prompt).toMatchObject({ code: 'conflict' });
    // 日報AIのマスターの自然キー(アーカイブした行も含む)
    expect(mapDatabaseError(pgError('23505', 'report_keywords_tenant_id_code_key'))).toMatchObject({
      code: 'conflict',
      reason: 'duplicate_key',
    });
    expect(mapDatabaseError(pgError('23505', 'report_phrases_tenant_id_kind_body_key'))).toMatchObject({
      code: 'conflict',
      reason: 'duplicate_key',
    });
  });

  it('対象外の一意制約・その他のエラーはそのまま返す(API は 500)', () => {
    const other = pgError('23505', 'receipts_pkey');
    expect(mapDatabaseError(other)).toBe(other);
    const reportPkey = pgError('23505', 'report_keywords_pkey');
    expect(mapDatabaseError(reportPkey)).toBe(reportPkey);
    const plain = new Error('x');
    expect(mapDatabaseError(plain)).toBe(plain);
  });
});

describe('drizzle の DrizzleQueryError の文(プロセスのログ)', () => {
  it('errorMessageOf・errorStackOf は params(入力の値)と SQL を出さず、cause の SQLSTATE と文にする', () => {
    const cause = Object.assign(
      new Error('duplicate key value violates unique constraint "staff_login_email_key"'),
      {
        code: '23505',
      },
    );
    const error = new DrizzleQueryError(
      'insert into "staff_login_emails" ("email") values ($1)',
      ['hanako@example.com'],
      cause,
    );
    // drizzle の文そのものには params が入る(この形を前提にしている)
    expect(error.message).toContain('\nparams: hanako@example.com');
    for (const text of [errorMessageOf(error), errorStackOf(error) ?? '']) {
      expect(text).not.toContain('hanako@example.com');
      expect(text).not.toContain('insert into');
      expect(text).toContain('23505');
    }
  });
});
