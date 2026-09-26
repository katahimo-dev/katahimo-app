/**
 * usecase が呼び出し元(APIルート・ジョブ)に返す、利用者に見せてよいエラー。
 * code は API のエラーコード(@katahimo/shared の apiErrorSchema)と1対1で対応し、HTTP ステータスへの
 * 変換は API の onError が1か所で行う。message は画面にそのまま出す日本語。
 * 想定外の例外(DB障害等)はこのクラスにせずそのまま投げる(API は 500 internal にする)。
 */
export type DomainErrorCode =
  | 'not_found'
  | 'forbidden'
  | 'validation_failed'
  | 'locked'
  | 'conflict'
  | 'rate_limited'
  | 'upstream_unavailable';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    /** 入力欄ごとのメッセージ(validation_failed・conflict で使う)。 */
    readonly fields?: Record<string, string>,
    /** ログ用の理由コード(画面には出さない)。 */
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (message: string, reason?: string) =>
  new DomainError('not_found', message, undefined, reason);
export const forbidden = (message: string, reason?: string) =>
  new DomainError('forbidden', message, undefined, reason);
export const invalid = (message: string, fields?: Record<string, string>, reason?: string) =>
  new DomainError('validation_failed', message, fields, reason);
export const conflict = (message: string, fields?: Record<string, string>, reason?: string) =>
  new DomainError('conflict', message, fields, reason);

/** 楽観的排他(row_version)の競合。 */
export const STALE_WRITE_MESSAGE =
  '他の人(または別の画面)が先に更新しました。画面を読み込み直してから、もう一度操作してください。';

/** AIプロンプトの版の競合(画面で読んだ後に、他の管理者が先に保存した)。 */
export const STALE_PROMPT_MESSAGE =
  '他の管理者が先にこのプロンプトを保存しました。画面を開きなおしてから保存してください。';

/**
 * 同じテナントの顧客の取込(顧客CSV・外部連携の API)が実行中で、取込のロックを待ちきれなかった(409 conflict)。
 * ロックの待ちの上限は DB ロールの lock_timeout(API 5秒・ワーカー 10秒)。
 */
export const CUSTOMER_IMPORT_BUSY_MESSAGE =
  '別の顧客の取込が実行中です。しばらくしてから送り直してください。';
/** そのときの DomainError の reason(ログ用)。 */
export const CUSTOMER_IMPORT_BUSY_REASON = 'customer_import_in_progress';

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
