import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { apiError } from './responses';

/**
 * 画面(packages/web のビルド出力)が必要とするものだけを許す Content-Security-Policy。
 * - スクリプトは同一オリジンのファイルだけ(ビルド出力にインラインスクリプトは無い。PWA の登録も
 *   /registerSW.js の外部ファイル)。
 * - スタイルは同一オリジンと Google Fonts の CSS。style 属性だけは index.html の #root が使うため許す
 *   (<style> 要素のインライン挿入は許さない)。
 * - フォントは Google Fonts、画像は同一オリジンと data:/blob:(領収書のプレビュー)。
 * - 通信は同一オリジンの /api だけ。他サイトへの埋め込み(フレーム)は禁止する。
 */
const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", 'https://fonts.googleapis.com'],
  styleSrcAttr: ["'unsafe-inline'"],
  fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
};

/**
 * 全レスポンス(API・画面の静的ファイル)に付けるセキュリティヘッダー。HSTS は本番(HTTPS)だけ
 * (開発の http://localhost に付けるとブラウザが以後 https を強制してしまうため)。
 */
export function securityHeaders(isProduction: boolean): MiddlewareHandler {
  return secureHeaders({
    contentSecurityPolicy: CONTENT_SECURITY_POLICY,
    strictTransportSecurity: isProduction ? 'max-age=31536000; includeSubDomains' : false,
    xContentTypeOptions: true,
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'same-origin',
    // Google Fonts をCORSなしで読むため、COEP は付けない
    crossOriginEmbedderPolicy: false,
    permissionsPolicy: { camera: ['self'], microphone: ['self'], geolocation: [], payment: [] },
  });
}

/**
 * API の応答はブラウザ・中継のキャッシュに残さない(個人情報を含むため)。ルートが no-store を含む指定
 * (領収書の画像の private, no-store)を付けていればそのまま使う。
 */
export function noStoreApiResponses(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    if (c.res.headers.get('Cache-Control')?.includes('no-store')) return;
    c.res.headers.set('Cache-Control', 'no-store');
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 状態を変えるAPI(POST/PUT/PATCH/DELETE)へのクロスサイトからの要求を拒否する(CSRF対策)。
 *
 * - Sec-Fetch-Site(現行のブラウザは必ず付ける)が same-origin / none 以外なら 403。
 * - Sec-Fetch-Site が無い古いブラウザは Origin を見て、自分のホスト(Host ヘッダー)と違えば 403。
 * - どちらも無い要求(curl 等のブラウザ以外)はそのまま通す(ブラウザ以外はCookieを勝手に送られる
 *   CSRFの前提に当たらないため)。
 * SameSite=Lax のCookieと合わせた多層防御。開発の Vite プロキシ(changeOrigin で Host が書き換わる)でも
 * ブラウザから見れば同一オリジンのため Sec-Fetch-Site: same-origin で通る。
 */
export function csrfProtection(): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const fetchSite = c.req.header('sec-fetch-site');
    if (fetchSite !== undefined) {
      if (fetchSite === 'same-origin' || fetchSite === 'none') return next();
      return apiError(c, 403, 'forbidden', '不正なリクエストです(別のサイトからの送信は受け付けません)。');
    }
    const origin = c.req.header('origin');
    if (origin !== undefined && !isSameHost(origin, c.req.header('host'))) {
      return apiError(c, 403, 'forbidden', '不正なリクエストです(別のサイトからの送信は受け付けません)。');
    }
    return next();
  };
}

function isSameHost(origin: string, host: string | undefined): boolean {
  if (!host || origin === 'null') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * 本体のある状態変更の要求は Content-Type: application/json だけを受け付ける(415)。フォーム送信
 * (application/x-www-form-urlencoded・multipart/form-data・text/plain)はクロスサイトから事前確認なしで
 * 送れるため、JSON API では受け取らない。本体の無い要求(ログアウト等)はそのまま通す。
 */
export function requireJsonBody(): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || !hasBody(c.req.raw)) return next();
    const contentType = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      return apiError(c, 415, 'validation_failed', 'Content-Type は application/json にしてください。');
    }
    return next();
  };
}

/** HTTP/1.1 では Content-Length も Transfer-Encoding も無い要求には本体が無い。 */
function hasBody(request: Request): boolean {
  const length = request.headers.get('content-length');
  if (length !== null) return Number(length) > 0;
  return request.headers.has('transfer-encoding');
}

const KB = 1024;
const MB = 1024 * KB;

/** 要求本体の大きさの上限。領収書(画像6枚まで)と領収書OCR(1枚)だけ大きくする。 */
export const BODY_LIMITS = {
  default: 256 * KB,
  receipts: 14 * MB,
  receiptOcr: 3 * MB,
} as const;

/**
 * パスに応じた本体の大きさの上限(超えたら 413)。領収書の上限は画像1枚あたりの上限
 * (shared の RECEIPT_IMAGE_MAX_BYTES、base64 で約4/3倍)× 6枚に余裕を持たせた値。
 */
export function apiBodyLimits(): MiddlewareHandler {
  const onError: Parameters<typeof bodyLimit>[0]['onError'] = (c) =>
    apiError(c, 413, 'validation_failed', '送信するデータが大きすぎます。');
  const limits = {
    default: bodyLimit({ maxSize: BODY_LIMITS.default, onError }),
    receipts: bodyLimit({ maxSize: BODY_LIMITS.receipts, onError }),
    receiptOcr: bodyLimit({ maxSize: BODY_LIMITS.receiptOcr, onError }),
  };
  return (c, next) => {
    const path = c.req.path.replace(/\/+$/, '');
    if (path === '/api/receipts') return limits.receipts(c, next);
    if (path === '/api/receipts/ocr') return limits.receiptOcr(c, next);
    return limits.default(c, next);
  };
}
