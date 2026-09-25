export interface GeminiModelInfo {
  name: string;
  displayName: string;
}

/**
 * 指定APIキーで実際に使えるモデル一覧を取得する(ListModels)。generateContentに対応している
 * モデルのみを返す。GAS版GeminiReport.js listAvailableGeminiModelsForAdminのAPI呼び出し部分に
 * 対応(保存前の入力中キーでも確認できるよう、常に呼び出し元から明示的にapiKeyを受け取る)。
 */
export async function listAvailableGeminiModels(apiKey: string): Promise<GeminiModelInfo[]> {
  const models: GeminiModelInfo[] = [];
  let pageToken = '';
  let pageCount = 0;

  do {
    let url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100';
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    // APIキーはURLに載せずヘッダーで送る。失敗時の応答本文はエラーに含めない(アプリログに残るため)。
    const response = await fetch(url, { headers: { 'x-goog-api-key': apiKey } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`モデル一覧の取得に失敗しました(HTTP ${response.status})`);
    }

    const json = (await response.json()) as {
      models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      nextPageToken?: string;
    };
    for (const m of json.models ?? []) {
      const methods = m.supportedGenerationMethods ?? [];
      if (methods.includes('generateContent')) {
        models.push({ name: (m.name ?? '').replace(/^models\//, ''), displayName: m.displayName ?? '' });
      }
    }
    pageToken = json.nextPageToken ?? '';
    pageCount++;
  } while (pageToken && pageCount < 5);

  models.sort((a, b) => a.name.localeCompare(b.name));
  return models;
}
