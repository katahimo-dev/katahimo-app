import { describe, expect, it } from 'vitest';
import { DomainError } from './domainError';
import { errorLogDetails, errorMessageOf, errorStackOf } from './errorLogDetails';

describe('errorLogDetails', () => {
  it('例外の文は残さず、種類と理由コードだけを返す', () => {
    const pg = Object.assign(new Error('duplicate key value violates "staff_email" (taro@example.com)'), {
      code: '23505',
    });
    expect(errorLogDetails(new Error('Failed query', { cause: pg }))).toEqual({
      errorClass: 'Error',
      errorCode: '23505',
    });
    expect(errorLogDetails(new TypeError('fetch failed: https://example.com/?key=secret'))).toEqual({
      errorClass: 'TypeError',
    });
    expect(
      errorLogDetails(new DomainError('upstream_unavailable', '予定を読めません', undefined, 'calendar')),
    ).toEqual({ errorClass: 'DomainError', errorCode: 'upstream_unavailable', errorReason: 'calendar' });
    expect(errorLogDetails(Object.assign(new Error('x'), { status: 503 }))).toEqual({
      errorClass: 'Error',
      httpStatus: 503,
    });
    // 記号でない code(文・長すぎる値)は残さない
    expect(errorLogDetails(Object.assign(new Error('x'), { code: 'bad value with spaces' }))).toEqual({
      errorClass: 'Error',
    });
    expect(errorLogDetails('string thrown')).toEqual({ errorClass: 'string' });
  });
});

/** drizzle の DrizzleQueryError と同じ形(文に SQL と params が入る)。 */
class DrizzleQueryError extends Error {
  constructor(
    readonly query: string,
    readonly params: unknown[],
    cause?: unknown,
  ) {
    super(`Failed query: ${query}\nparams: ${params}`);
    this.cause = cause;
  }
}

describe('errorMessageOf・errorStackOf', () => {
  const pg = Object.assign(new Error('duplicate key value violates unique constraint "staff_email_key"'), {
    code: '23505',
  });
  pg.name = 'PostgresError';
  const query = new DrizzleQueryError('insert into "staff" ("email") values ($1)', ['taro@example.com'], pg);

  it('ふつうの例外は文のまま', () => {
    expect(errorMessageOf(new Error('予定を読めません'))).toBe('予定を読めません');
    expect(errorMessageOf('string thrown')).toBe('string thrown');
  });

  it('DB の問い合わせの失敗は params(入力の値)も SQL も出さず、cause の種類・SQLSTATE・文にする', () => {
    const message = errorMessageOf(query);
    expect(message).toBe(
      'DB の問い合わせに失敗しました(Error 23505: duplicate key value violates unique constraint "staff_email_key")',
    );
    expect(message).not.toContain('taro@example.com');
    expect(message).not.toContain('insert into');
    // それを包んだ例外(文に元の文を入れたもの)も同じ
    const wrapped = new Error(`保存に失敗しました: ${query.message}`, { cause: query });
    expect(errorMessageOf(wrapped)).toBe(message);
    // cause が無い・cause の文にも params があるときは種類だけ
    expect(errorMessageOf(new DrizzleQueryError('select $1', ['secret-token']))).toBe(
      'DB の問い合わせに失敗しました(DrizzleQueryError)',
    );
    expect(errorMessageOf('Failed query: select 1\nparams: secret')).toBe(
      'DB の問い合わせに失敗しました(string)',
    );
  });

  it('スタックも先頭の文を置き換え、呼び出しの行だけを残す', () => {
    const stack = errorStackOf(query) ?? '';
    expect(stack).not.toContain('taro@example.com');
    expect(stack).not.toContain('insert into');
    expect(stack.split('\n')[0]).toBe(`Error: ${errorMessageOf(query)}`);
    expect(stack).toMatch(/\n\s+at /);
    const plain = new Error('ふつうの失敗');
    expect(errorStackOf(plain)).toBe(plain.stack);
  });
});
