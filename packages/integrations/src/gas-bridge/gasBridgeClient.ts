export interface GasBridgeOptions {
  /** GAS版(gas-childcare-visit-app)Web Appの/execエンドポイントURL。 */
  baseUrl: string;
  /** GAS側Bridge.jsのBRIDGE_API_SECRET(Script Properties)と同じ値。 */
  secret: string;
}

/** Bridge.js(GAS版Web Appの?api=1エンドポイント)への共通クライアント。 */
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

  async fetchJson<T>(action: string, params: Record<string, string>): Promise<T> {
    const res = await fetch(this.buildUrl(action, params));
    return (await res.json()) as T;
  }

  /**
   * ミラー書き込み(daily_report/accident_report/receipt/attendance_day)用。領収書画像の
   * base64データ等、URLクエリに載せるには大きすぎる/不向きなペイロードをJSON POST本体で送る。
   * secret/actionはGET側と同じくURLクエリに載せる(Bridge.js側のdoPost(e).parameterで読む)。
   */
  async postJson<T>(action: string, body: unknown): Promise<T> {
    const res = await fetch(this.buildUrl(action, {}), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  }
}
