import { afterEach, describe, expect, it, vi } from 'vitest';

const getOptions = vi.fn();
const close = vi.fn();
const constructed = vi.fn();

vi.mock('@google-cloud/cloud-sql-connector', () => ({
  IpAddressTypes: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE', PSC: 'PSC' },
  Connector: class {
    constructor() {
      constructed();
    }
    getOptions = getOptions;
    close = close;
  },
}));

const { cloudSqlSocketFactory } = await import('./cloudSqlConnector');

const target = { instanceConnectionName: 'p:asia-northeast1:i', ipType: 'PRIVATE' as const };

describe('cloudSqlSocketFactory', () => {
  afterEach(() => vi.clearAllMocks());

  it('接続先の情報はプールで1回だけ取り、接続ごとに新しいソケットを作る', async () => {
    let n = 0;
    getOptions.mockResolvedValue({ stream: () => ({ id: ++n }) });
    const factory = cloudSqlSocketFactory(target);
    expect(await factory.socket()).toEqual({ id: 1 });
    expect(await factory.socket()).toEqual({ id: 2 });
    expect(constructed).toHaveBeenCalledTimes(1);
    expect(getOptions).toHaveBeenCalledTimes(1);
    expect(getOptions).toHaveBeenCalledWith({
      instanceConnectionName: 'p:asia-northeast1:i',
      ipType: 'PRIVATE',
    });
    factory.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('接続先の情報を取れなければ、次の接続で取り直す', async () => {
    getOptions.mockRejectedValueOnce(new Error('sqladmin unavailable'));
    getOptions.mockResolvedValueOnce({ stream: () => ({ ok: true }) });
    const factory = cloudSqlSocketFactory(target);
    await expect(factory.socket()).rejects.toThrow('sqladmin unavailable');
    expect(await factory.socket()).toEqual({ ok: true });
    expect(getOptions).toHaveBeenCalledTimes(2);
  });

  it('閉じた後は新しくつながない', async () => {
    const factory = cloudSqlSocketFactory(target);
    factory.close();
    await expect(factory.socket()).rejects.toThrow('閉じています');
    expect(constructed).not.toHaveBeenCalled();
  });
});
