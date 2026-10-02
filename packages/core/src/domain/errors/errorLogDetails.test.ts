import { describe, expect, it } from 'vitest';
import { DomainError } from './domainError';
import { errorLogDetails } from './errorLogDetails';

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
