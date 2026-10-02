import { DomainError } from './domainError';

/**
 * 操作ログ(app_logs.details)に残す例外の要約: 例外の種類(クラスの名前)と理由コードだけ。例外の文は残さない
 * (外部サービス・DB の例外の文には URL・SQL・入力の値(個人情報)が入りうるため。文はプロセスのログ(ジョブの出力・
 * API の要求のログ)にだけ出す)。
 * - errorClass: Error のクラスの名前(`TypeError`・`DomainError`・`PostgresError` 等)。Error でなければ `typeof` の値
 * - errorCode: DomainError は code(と reason)、それ以外は例外・cause の `code`(SQLSTATE・Node の `ERR_*`・`ECONNRESET` 等の
 *   短い記号だけ)
 * - httpStatus: 例外・cause の `status` / `statusCode`(数)
 */
export interface ErrorLogDetails {
  errorClass: string;
  errorCode?: string;
  errorReason?: string;
  httpStatus?: number;
}

const CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

function classOf(error: unknown): string {
  if (error instanceof Error) {
    const name = error.constructor?.name;
    return name && name !== 'Object' ? name : error.name || 'Error';
  }
  return error === null ? 'null' : typeof error;
}

export function errorLogDetails(error: unknown): ErrorLogDetails {
  const details: ErrorLogDetails = { errorClass: classOf(error) };
  if (error instanceof DomainError) {
    details.errorCode = error.code;
    if (error.reason && CODE_PATTERN.test(error.reason)) details.errorReason = error.reason;
    return details;
  }
  // drizzle・fetch は元の例外を cause に包む。浅い所から順に、最初に見つかった記号・状態を使う
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const candidate = current as { code?: unknown; status?: unknown; statusCode?: unknown; cause?: unknown };
    if (details.errorCode === undefined) {
      if (typeof candidate.code === 'string' && CODE_PATTERN.test(candidate.code))
        details.errorCode = candidate.code;
      else if (typeof candidate.code === 'number' && Number.isInteger(candidate.code))
        details.errorCode = String(candidate.code);
    }
    if (details.httpStatus === undefined) {
      const status = typeof candidate.status === 'number' ? candidate.status : candidate.statusCode;
      if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599)
        details.httpStatus = status;
    }
    current = candidate.cause;
  }
  return details;
}

/** ジョブの結果・プロセスのログに出す例外の文(操作ログには入れない)。 */
export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
