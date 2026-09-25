import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from './memoryStorage.test-helper';
import { pushRecentCustomer, readRecentCustomerIds } from './recentCustomers';

const SCOPE = { tenantId: 't1', staffId: 's1' };

describe('recentCustomers', () => {
  it('人ごとのキーに新しい順で入れる。壊れていたら空', () => {
    const storage = createMemoryStorage({ 'recent_customers@t1/s1': '["a","b",3]' });
    expect(readRecentCustomerIds(SCOPE, storage)).toEqual(['a', 'b']);
    pushRecentCustomer('b', SCOPE, storage);
    expect(readRecentCustomerIds(SCOPE, storage)).toEqual(['b', 'a']);
    expect(readRecentCustomerIds({ tenantId: 't1', staffId: 's2' }, storage)).toEqual([]);
    expect(readRecentCustomerIds(SCOPE, createMemoryStorage({ 'recent_customers@t1/s1': '{' }))).toEqual([]);
  });

  it('50件まで', () => {
    const storage = createMemoryStorage();
    for (let i = 0; i < 55; i++) pushRecentCustomer(`c${i}`, SCOPE, storage);
    const list = readRecentCustomerIds(SCOPE, storage);
    expect(list).toHaveLength(50);
    expect(list[0]).toBe('c54');
  });
});
