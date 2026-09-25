import { useSyncExternalStore } from 'react';
import { hideToast, toastStore } from './toastStore';

/**
 * GAS版 #toast と同じ見た目。下タブに重ならないよう bottom-20、どのダイアログよりも手前に出るよう
 * z-[130]。外側は pointer-events-none のままにし、「閉じる」ボタンだけ押せるようにしている。
 * AppRoot で1つだけ置く。出すときは `showToast()` を呼ぶ。
 */
export function Toast() {
  const state = useSyncExternalStore(toastStore.subscribe, toastStore.getState);
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-20 left-1/2 transform -translate-x-1/2 max-w-[90vw] ${
        state.isError ? 'bg-red-700' : 'bg-gray-800'
      } text-white px-4 py-3 rounded-2xl shadow-lg transition-opacity duration-300 ${
        state.visible ? '' : 'opacity-0'
      } pointer-events-none z-[130] text-base font-bold flex items-center gap-3`}
    >
      <span>{state.message}</span>
      <button
        type="button"
        onClick={hideToast}
        className={`${
          state.closeButtonVisible ? '' : 'hidden '
        }pointer-events-auto min-h-11 px-3 py-2 rounded-xl bg-white/25 text-white text-sm font-bold flex-shrink-0`}
      >
        閉じる
      </button>
    </div>
  );
}
