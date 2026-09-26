import { XLSX_CONTENT_TYPE } from '@katahimo/shared';
import type { Context } from 'hono';

/**
 * ファイルのダウンロードの Content-Disposition。filename* に UTF-8 の名前(RFC 5987 / 6266)、filename に
 * ASCII だけの代わりの名前を付ける(日本語の名前を読めない古い仕組みでも保存できるように)。
 */
export function attachmentDisposition(filename: string, asciiFallback: string): string {
  const ascii = asciiFallback.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** ファイル名に使えない文字(\ / : * ? " < > | と制御文字)を _ にする。 */
export function safeFileName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字はファイル名に使えないため置き換える
  return name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim() || 'download';
}

/** .xlsx の応答(保存用。キャッシュさせない)。 */
export function xlsxResponse(c: Context, body: Buffer, filename: string, asciiFallback: string): Response {
  c.header('Content-Type', XLSX_CONTENT_TYPE);
  c.header('Content-Disposition', attachmentDisposition(safeFileName(filename), asciiFallback));
  c.header('Content-Length', String(body.byteLength));
  c.header('Cache-Control', 'no-store');
  return c.body(new Uint8Array(body));
}
