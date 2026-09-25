import { describe, expect, it } from 'vitest';
import { StopSignal } from './stopSignal';

describe('StopSignal', () => {
  it('sleep は stop() ですぐに戻り、以後の sleep は待たない', async () => {
    const stop = new StopSignal();
    const started = Date.now();
    const waiting = stop.sleep(60_000);
    setTimeout(() => stop.stop(), 10);
    await waiting;
    await stop.sleep(60_000);
    expect(stop.stopped).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
