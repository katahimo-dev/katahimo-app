export interface GasBridgeOptions {
  /** GAS版(gas-childcare-visit-app)Web Appの/execエンドポイントURL。 */
  baseUrl: string;
  /** GAS側Bridge.jsのBRIDGE_API_SECRET(Script Properties)と同じ値。 */
  secret: string;
  /** 1リクエストのタイムアウト(ミリ秒)。Apps Scriptの実行時間上限(6分)より短くする。省略時は120秒。 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** Bridge.js 以外の中継(プロキシ等)が読むための共有シークレットのヘッダー。 */
export const GAS_BRIDGE_SECRET_HEADER = 'X-Katahimo-Bridge-Secret';

/**
 * Bridge.js(GAS版Web Appの?api=1エンドポイント)への共通クライアント。
 *
 * 共有シークレットはヘッダー(GAS_BRIDGE_SECRET_HEADER)とURLクエリ(secret)の両方に付ける。Apps Script の
 * Web App(doGet/doPost の e)はリクエストヘッダーを読めないため、Bridge.js は今もクエリの secret で認証
 * しており、クエリは外せない。POST 本体で受け取るよう Bridge.js を変えたら(doc/api/attendance-batch.md
 * 「Bridge.js 側の変更」)、クエリの secret は POST から外す。URL(シークレットを含む)はログ・例外の
 * メッセージに入れないこと。
 */
export class GasBridgeClient {
  constructor(private readonly options: GasBridgeOptions) {}

  private buildUrl(action: string, params: Record<string, string>): string {
    const url = new URL(this.options.baseUrl);
    url.searchParams.set('api', '1');
    url.searchParams.set('secret', this.options.secret);
    url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /** HTTPエラー・JSON以外の応答(ログイン画面へのリダイレクト等)は、actionを添えた例外にする。 */
  private async request<T>(action: string, url: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { ...init.headers, [GAS_BRIDGE_SECRET_HEADER]: this.options.secret },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      // URL(シークレットを含む)はメッセージに入れず、原因だけを残す。
      const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`GASブリッジに接続できませんでした(action=${action}): ${reason}${cause}`);
    }
    if (!res.ok) {
      throw new Error(`GASブリッジがHTTP ${res.status} を返しました(action=${action})`);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error(`GASブリッジの応答がJSONではありません(action=${action})`);
    }
  }

  async fetchJson<T>(action: string, params: Record<string, string>): Promise<T> {
    return this.request<T>(action, this.buildUrl(action, params));
  }

  /**
   * ミラー書き込み(daily_report/accident_report/receipt/attendance_day)用。領収書画像の
   * base64データ等、URLクエリに載せるには大きすぎる/不向きなペイロードをJSON POST本体で送る。
   * secret/actionはGET側と同じくURLクエリに載せる(Bridge.js側のdoPost(e).parameterで読む)。
   */
  async postJson<T>(action: string, body: unknown): Promise<T> {
    return this.request<T>(action, this.buildUrl(action, {}), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
