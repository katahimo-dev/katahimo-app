import type { OutboxDrainTriggerPort } from '@katahimo/core/ports';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const CLOUD_RUN_ADMIN_API = 'https://run.googleapis.com/v2';

/** Cloud Run のジョブの完全な名前(projects/<p>/locations/<r>/jobs/<job>)。 */
export const CLOUD_RUN_JOB_NAME_PATTERN = /^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/jobs\/[a-z0-9-]+$/;

export interface CloudRunJobDrainTriggerOptions {
  /** 起動するジョブ(OUTBOX_DRAIN_JOB。projects/<p>/locations/<r>/jobs/katahimo-outbox-drain)。 */
  jobName: string;
  /** アクセストークン(省略時は Application Default Credentials = Cloud Run の実行SAのメタデータのトークン)。 */
  getAccessToken?: () => Promise<string>;
  fetch?: typeof fetch;
  /** 1回の依頼の上限時間(利用者の操作の応答を長く待たせない)。 */
  timeoutMs?: number;
}

/** ADC のアクセストークン(google-auth-library はトークンを期限まで使い回す)。読み込みは最初の依頼まで遅らせる。 */
function adcAccessToken(): () => Promise<string> {
  let auth: Promise<import('google-auth-library').GoogleAuth> | null = null;
  return async () => {
    auth ??= import('google-auth-library').then(
      ({ GoogleAuth }) => new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] }),
    );
    const token = await (await auth).getAccessToken();
    if (!token) throw new Error('アクセストークンを取得できません');
    return token;
  };
}

/**
 * Cloud Run Admin API の jobs.run(`POST /v2/{name}:run`)で outbox-drain の実行を1回頼む。上書き(overrides)は
 * 付けないため、実行SA(katahimo-api)にはそのジョブに対する run.jobs.run(roles/run.invoker)だけがあればよい
 * (infra/gcp/iam.tf)。jobs.run は実行の開始を受け付けた時点で長時間実行の操作(Operation)を返す(完了は待たない)。
 */
export class CloudRunJobDrainTrigger implements OutboxDrainTriggerPort {
  private readonly url: string;
  private readonly getAccessToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: CloudRunJobDrainTriggerOptions) {
    if (!CLOUD_RUN_JOB_NAME_PATTERN.test(options.jobName)) {
      throw new Error(
        'OUTBOX_DRAIN_JOB は projects/<プロジェクト>/locations/<リージョン>/jobs/<ジョブ> の形式で指定してください',
      );
    }
    this.url = `${CLOUD_RUN_ADMIN_API}/${options.jobName}:run`;
    this.getAccessToken = options.getAccessToken ?? adcAccessToken();
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async requestDrain(): Promise<void> {
    const token = await this.getAccessToken();
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      // Google API のエラーの status(PERMISSION_DENIED 等)だけを残す(本文は長いことがある)
      const status = await res
        .json()
        .then((body) => (body as { error?: { status?: unknown } } | null)?.error?.status)
        .catch(() => undefined);
      throw new Error(
        `Cloud Run の jobs.run が失敗しました(HTTP ${res.status}${typeof status === 'string' ? ` ${status}` : ''})`,
      );
    }
  }
}

/** OUTBOX_DRAIN_JOB が設定されていれば Cloud Run の jobs.run で頼む実装、無ければ null(ローカル開発)。 */
export function createOutboxDrainTrigger(env: {
  OUTBOX_DRAIN_JOB?: string | undefined;
}): OutboxDrainTriggerPort | null {
  return env.OUTBOX_DRAIN_JOB ? new CloudRunJobDrainTrigger({ jobName: env.OUTBOX_DRAIN_JOB }) : null;
}
