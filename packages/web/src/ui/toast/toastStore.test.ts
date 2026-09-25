import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToastStore, TOAST_AUTO_HIDE_MS } from './toastStore';

describe('toastStore(GAS版 showToast / hideToast)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ふつうのお知らせは4秒で消え、「閉じる」は出さない', () => {
    const store = createToastStore();
    store.show('設定を保存しました');
    expect(store.getState()).toEqual({
      message: '設定を保存しました',
      isError: false,
      visible: true,
      closeButtonVisible: false,
    });
    vi.advanceTimersByTime(TOAST_AUTO_HIDE_MS - 1);
    expect(store.getState().visible).toBe(true);
    vi.advanceTimersByTime(1);
    // 消えたあとも文言は残す(フェードアウト中に文言が消えないように)
    expect(store.getState()).toMatchObject({ message: '設定を保存しました', visible: false });
  });

  it('失敗のお知らせは自動では消さず、「閉じる」を出す', () => {
    const store = createToastStore();
    store.show('モデルが未選択です', true);
    vi.advanceTimersByTime(60_000);
    expect(store.getState()).toEqual({
      message: 'モデルが未選択です',
      isError: true,
      visible: true,
      closeButtonVisible: true,
    });
    store.hide();
    expect(store.getState()).toMatchObject({ visible: false, closeButtonVisible: false });
  });

  it('続けて出したときは前のタイマーで新しいお知らせが消えない', () => {
    const store = createToastStore();
    store.show('1つめ');
    vi.advanceTimersByTime(3000);
    store.show('2つめ');
    vi.advanceTimersByTime(1500); // 1つめのタイマーなら消えている時刻
    expect(store.getState()).toMatchObject({ message: '2つめ', visible: true });
    vi.advanceTimersByTime(2500);
    expect(store.getState().visible).toBe(false);
  });

  it('ふつう→失敗の順に出したら、失敗のお知らせは消えない', () => {
    const store = createToastStore();
    store.show('文字の大きさ: 大きい');
    store.show('うまくいきませんでした', true);
    vi.advanceTimersByTime(TOAST_AUTO_HIDE_MS * 2);
    expect(store.getState()).toMatchObject({ isError: true, visible: true, closeButtonVisible: true });
  });

  it('変わるたびに購読者へ知らせ、解除後は知らせない', () => {
    const store = createToastStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.show('a');
    vi.advanceTimersByTime(TOAST_AUTO_HIDE_MS);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.show('b');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
