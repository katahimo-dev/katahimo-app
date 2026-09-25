/**
 * 画面下のお知らせ(トースト)の状態。GAS版 showToast / hideToast と同じ動き:
 *
 * - ふつうのお知らせ(isError=false)は4秒で自動的に消える。
 * - 失敗のお知らせ(isError=true)は読み切る前に消えないよう自動では消さず、「閉じる」で消す。
 * - 続けて出したときは前のタイマーを止める(前のタイマーが新しいお知らせを消さないように)。
 * - 消えるとき(透明になるとき)は「閉じる」も隠す(見えないボタンが指の操作を横取りしないように)。
 * - 文言は消えたあとも残す(GAS版は透明にするだけで文言を書きかえないため、フェードアウト中も同じ文言)。
 *
 * React の外(APIクライアント等)からも呼べるよう、モジュール単位の小さなストアにしている。
 * 画面側は `<Toast />` が useSyncExternalStore で購読する。
 */
export interface ToastState {
  message: string;
  isError: boolean;
  visible: boolean;
  closeButtonVisible: boolean;
}

export const TOAST_AUTO_HIDE_MS = 4000;

type Listener = () => void;

/** タイマーを差し替えられるようにしている(テストで偽のタイマーを使うため)。 */
export interface TimerApi {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

const defaultTimers: TimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
};

export function createToastStore(timers: TimerApi = defaultTimers) {
  // GAS版の初期状態(非表示・灰色)と同じ
  let state: ToastState = { message: '', isError: false, visible: false, closeButtonVisible: false };
  let hideTimer: unknown = null;
  const listeners = new Set<Listener>();

  const set = (next: ToastState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const clearHideTimer = () => {
    if (hideTimer !== null) {
      timers.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  return {
    getState: () => state,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    show(message: string, isError = false) {
      clearHideTimer();
      set({ message, isError, visible: true, closeButtonVisible: isError });
      if (!isError) {
        hideTimer = timers.setTimeout(() => {
          hideTimer = null;
          set({ ...state, visible: false, closeButtonVisible: false });
        }, TOAST_AUTO_HIDE_MS);
      }
    },
    hide() {
      clearHideTimer();
      set({ ...state, visible: false, closeButtonVisible: false });
    },
  };
}

export type ToastStore = ReturnType<typeof createToastStore>;

/** アプリ全体で1つのトースト。 */
export const toastStore = createToastStore();

/** GAS版 showToast(message, isError) と同じ呼び方。 */
export function showToast(message: string, isError = false) {
  toastStore.show(message, isError);
}

/** GAS版 hideToast() と同じ。 */
export function hideToast() {
  toastStore.hide();
}
