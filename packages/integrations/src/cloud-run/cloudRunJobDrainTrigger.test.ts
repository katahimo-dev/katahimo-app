import { describe, expect, it } from 'vitest';
import { CloudRunJobDrainTrigger, createOutboxDrainTrigger } from './cloudRunJobDrainTrigger';

const JOB = 'projects/katahimo-prod/locations/asia-northeast1/jobs/katahimo-outbox-drain';

function fakeFetch(response: Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response;
  }) as typeof fetch;
  return { calls, impl };
}

describe('CloudRunJobDrainTrigger', () => {
  it('jobs.run を実行SAのトークン付き・上書きなし(空の本文)で呼ぶ', async () => {
    const fetch = fakeFetch(new Response(JSON.stringify({ name: 'operations/1' }), { status: 200 }));
    const trigger = new CloudRunJobDrainTrigger({
      jobName: JOB,
      getAccessToken: async () => 'ya29.token',
      fetch: fetch.impl,
    });
    await trigger.requestDrain();
    expect(fetch.calls).toHaveLength(1);
    const [call] = fetch.calls;
    expect(call?.url).toBe(`https://run.googleapis.com/v2/${JOB}:run`);
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toEqual({
      Authorization: 'Bearer ya29.token',
      'Content-Type': 'application/json',
    });
    expect(call?.init.body).toBe('{}');
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('失敗の応答は HTTP ステータスと Google API の status だけを添えて例外にする', async () => {
    const body = {
      error: { code: 403, status: 'PERMISSION_DENIED', message: 'Permission run.jobs.run denied' },
    };
    const fetch = fakeFetch(new Response(JSON.stringify(body), { status: 403 }));
    const trigger = new CloudRunJobDrainTrigger({
      jobName: JOB,
      getAccessToken: async () => 't',
      fetch: fetch.impl,
    });
    await expect(trigger.requestDrain()).rejects.toThrow(
      'Cloud Run の jobs.run が失敗しました(HTTP 403 PERMISSION_DENIED)',
    );

    const html = fakeFetch(new Response('<html>', { status: 502 }));
    const other = new CloudRunJobDrainTrigger({
      jobName: JOB,
      getAccessToken: async () => 't',
      fetch: html.impl,
    });
    await expect(other.requestDrain()).rejects.toThrow('(HTTP 502)');
  });

  it('トークンを取れなければ呼ばずに例外にする', async () => {
    const fetch = fakeFetch(new Response('{}'));
    const trigger = new CloudRunJobDrainTrigger({
      jobName: JOB,
      getAccessToken: async () => {
        throw new Error('metadata server unavailable');
      },
      fetch: fetch.impl,
    });
    await expect(trigger.requestDrain()).rejects.toThrow('metadata server unavailable');
    expect(fetch.calls).toHaveLength(0);
  });

  it('ジョブの名前の形式が違えば作れない。OUTBOX_DRAIN_JOB が無ければ null(ローカル開発)', () => {
    expect(() => new CloudRunJobDrainTrigger({ jobName: 'katahimo-outbox-drain' })).toThrow(
      /OUTBOX_DRAIN_JOB/,
    );
    expect(() => new CloudRunJobDrainTrigger({ jobName: `${JOB}/executions/x` })).toThrow(/OUTBOX_DRAIN_JOB/);
    expect(createOutboxDrainTrigger({ OUTBOX_DRAIN_JOB: JOB })).toBeInstanceOf(CloudRunJobDrainTrigger);
    expect(createOutboxDrainTrigger({})).toBeNull();
  });
});
