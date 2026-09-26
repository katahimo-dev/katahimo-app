import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveBlobAsFile } from './saveFile';

describe('saveBlobAsFile(ダウンロードした中身をファイルとして保存する)', () => {
  const createObjectURL = vi.fn(() => 'blob:http://localhost/file-1');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it('一時的なリンクを作って押し、すぐ取り除く。URL は60秒後に捨てる', () => {
    const clicked: { href: string; download: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, attached: document.body.contains(this) });
    });
    const blob = new Blob(['a,b\r\n'], { type: 'text/csv' });

    saveBlobAsFile(blob, '操作ログ.csv');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([
      { href: 'blob:http://localhost/file-1', download: '操作ログ.csv', attached: true },
    ]);
    // 押した後はリンクを残さない
    expect(document.querySelectorAll('a').length).toBe(0);
    // すぐには捨てない(保存が始まる前に消える端末があるため)
    vi.advanceTimersByTime(59_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/file-1');
  });
});
