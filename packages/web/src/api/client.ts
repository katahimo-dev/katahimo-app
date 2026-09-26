import { type ApiError, apiErrorSchema } from '@katahimo/shared';
import type { z } from 'zod';
import { NETWORK_ERROR_MESSAGE } from '../lib/messages';

/**
 * APIを呼ぶ共通の入口。応答は必ず @katahimo/shared のzodスキーマで検証してから返す
 * (サーバーとの食い違いを画面の奥で気づくのではなく、ここで気づけるようにするため)。
 *
 * エラーは2種類に分ける(GAS版の withSuccessHandler / withFailureHandler の区別に相当):
 * - `ApiRequestError`: サーバーが理由(apiErrorSchema)を返した(GAS版で success:false と message が返った場合)。
 *   画面にはサーバーの message をそのまま出す。
 * - `NetworkError`: 通信失敗・理由の無いエラー・応答の形が違う(GAS版の withFailureHandler)。
 *   画面には「うまくいきませんでした。電波を確認して、もう一度押してください」を出す。
 * どちらも `userMessageOf(error)` で画面に出す文言が得られる。
 */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiError['code'];
  readonly fields: Record<string, string> | undefined;
  /** 回数の上限(429 rate_limited)のとき、もう一度使えるまでの秒数(Retry-After)。 */
  readonly retryAfterSeconds: number | null;

  constructor(status: number, body: ApiError, retryAfterSeconds: number | null = null) {
    super(body.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body.code;
    this.fields = body.fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Retry-After(秒数)を読む。日時の形・無いときは null */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

/** 「あと約15分」「あと約3時間」(回数の上限のお知らせに添える) */
export function formatRetryAfter(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes < 120 ? `あと約${minutes}分` : `あと約${Math.ceil(minutes / 60)}時間`;
}

export class NetworkError extends Error {
  readonly status: number | null;

  constructor(detail: string, status: number | null = null) {
    super(detail);
    this.name = 'NetworkError';
    this.status = status;
  }
}

/**
 * 画面に出す文言。サーバーが理由を返したらその理由、それ以外はGAS版と同じ通信失敗の文言。
 * 回数の上限(429)で、もう一度使えるまでの時間が分かるときは「（あと約15分）」を添える。
 */
export function userMessageOf(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'rate_limited' && error.retryAfterSeconds !== null) {
      return `${error.message}（${formatRetryAfter(error.retryAfterSeconds)}）`;
    }
    return error.message;
  }
  return NETWORK_ERROR_MESSAGE;
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

type UnauthenticatedListener = () => void;
let unauthenticatedListener: UnauthenticatedListener | null = null;

/**
 * ログイン中にセッションが切れた(401)ときに呼ばれる処理を登録する(features/auth が登録する)。
 * ログイン・パスワード再設定など、未ログインで呼ぶAPIでは呼ばれない(`skipAuthHandler`)。
 */
export function setUnauthenticatedListener(listener: UnauthenticatedListener | null) {
  unauthenticatedListener = listener;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** 401でもセッション切れ扱いにしない(ログイン画面から呼ぶAPI用) */
  skipAuthHandler?: boolean;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** fetch を呼ぶ(通信の失敗は NetworkError。中断はそのまま投げる)。 */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { credentials: 'include', ...init });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new NetworkError(e instanceof Error ? e.message : String(e));
  }
}

/** 失敗の応答をエラーにする(本文の JSON は json に読んだもの)。 */
function failureOf(
  method: string,
  url: string,
  res: Response,
  json: unknown,
  options: RequestOptions,
): Error {
  const parsedError = apiErrorSchema.safeParse(json);
  // サーバーが理由(message)を付けて返したものは、5xx(外部サービスの失敗等)でもその理由を出す。
  // 理由の無い失敗・想定外の失敗(code=internal)は通信失敗と同じ扱いにする。
  if (parsedError.success && parsedError.data.code !== 'internal') {
    if (res.status === 401 && !options.skipAuthHandler) unauthenticatedListener?.();
    return new ApiRequestError(res.status, parsedError.data, parseRetryAfter(res.headers.get('Retry-After')));
  }
  return new NetworkError(`${method} ${url} が ${res.status} を返しました`, res.status);
}

async function request<S extends z.ZodTypeAny>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  schema: S,
  body: unknown,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  const res = await send(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal,
  });

  const json: unknown = await res.json().catch(() => undefined);

  if (!res.ok) throw failureOf(method, url, res, json, options);

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.error(`${method} ${url} の応答が契約と一致しません`, parsed.error.issues);
    throw new NetworkError(`${method} ${url} の応答が契約と一致しません`, res.status);
  }
  return parsed.data;
}

/** ダウンロードしたファイル。 */
export interface DownloadedFile {
  blob: Blob;
  /** Content-Disposition の名前(filename* の UTF-8 を優先)。無ければ fallbackName。 */
  filename: string;
}

/** Content-Disposition からファイル名を読む(RFC 5987 の filename* を優先)。 */
export function filenameFromDisposition(header: string | null, fallbackName: string): string {
  if (!header) return fallbackName;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // 読めない名前は下の filename を使う
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain?.[1]?.trim() || fallbackName;
}

/**
 * ファイルをダウンロードする(GET)。失敗は JSON の理由を読んで、ふつうの API と同じエラーにする
 * (<a download> で開くと、断られたときに理由の JSON がファイルとして保存されてしまうため)。
 * 成功しても期待した種類(expectedType)でなければ通信の失敗として扱う。
 */
async function download(
  path: string,
  query: Query | undefined,
  expectedType: string,
  fallbackName: string,
  options: RequestOptions = {},
): Promise<DownloadedFile> {
  const url = buildUrl(path, query);
  const res = await send(url, { method: 'GET', signal: options.signal });
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => undefined);
    throw failureOf('GET', url, res, json, options);
  }
  const type = res.headers.get('Content-Type') ?? '';
  if (!type.startsWith(expectedType)) {
    throw new NetworkError(`GET ${url} の応答の種類が違います(${type})`, res.status);
  }
  const blob = await res.blob();
  return { blob, filename: filenameFromDisposition(res.headers.get('Content-Disposition'), fallbackName) };
}

export const api = {
  get<S extends z.ZodTypeAny>(path: string, schema: S, query?: Query, options?: RequestOptions) {
    return request('GET', buildUrl(path, query), schema, undefined, options);
  },
  post<S extends z.ZodTypeAny>(path: string, schema: S, body: unknown = {}, options?: RequestOptions) {
    return request('POST', path, schema, body, options);
  },
  put<S extends z.ZodTypeAny>(path: string, schema: S, body: unknown = {}, options?: RequestOptions) {
    return request('PUT', path, schema, body, options);
  },
  patch<S extends z.ZodTypeAny>(path: string, schema: S, body: unknown = {}, options?: RequestOptions) {
    return request('PATCH', path, schema, body, options);
  },
  delete<S extends z.ZodTypeAny>(path: string, schema: S, body?: unknown, options?: RequestOptions) {
    return request('DELETE', path, schema, body, options);
  },
  download,
};
