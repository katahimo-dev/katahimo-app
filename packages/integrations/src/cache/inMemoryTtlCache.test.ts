import { describe, expect, it } from 'vitest';
import { InMemoryTtlCache } from './inMemoryTtlCache';

describe('InMemoryTtlCache', () => {
  it('TTLが切れるまで値を返し、切れたら undefined', async () => {
    let now = 1_000;
    const cache = new InMemoryTtlCache({ maxEntries: 10, now: () => now });
    await cache.set('k', { a: 1 }, 60);
    now += 59_999;
    expect(await cache.get('k')).toEqual({ a: 1 });
    now += 1;
    expect(await cache.get('k')).toBeUndefined();
  });

  it('上限を超えたら最も長く使われていないものから捨てる', async () => {
    const cache = new InMemoryTtlCache({ maxEntries: 2 });
    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);
    await cache.get('a');
    await cache.set('c', 3, 60);
    expect(await cache.get('a')).toBe(1);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('c')).toBe(3);
  });

  it('取り出した値を書き換えてもキャッシュの中身は変わらない', async () => {
    const cache = new InMemoryTtlCache({ maxEntries: 2 });
    const value = { list: [1] };
    await cache.set('k', value, 60);
    value.list.push(2);
    const got = await cache.get<{ list: number[] }>('k');
    got?.list.push(3);
    expect(await cache.get('k')).toEqual({ list: [1] });
  });
});
