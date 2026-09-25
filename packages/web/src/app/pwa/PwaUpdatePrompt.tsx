import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect } from 'react';
import { showActionToast } from '../../ui/toast';

/** 新しい版があるか確かめる間隔(開いたままにされることが多いため、1時間ごとに確かめる) */
export const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export const UPDATE_AVAILABLE_MESSAGE = '新しい版があります';
export const UPDATE_ACTION_LABEL = '更新する';

/**
 * PWA(Service Worker)の更新のお知らせ。新しい版が届いたら、書きかけの入力を消さないよう勝手には
 * 読み込み直さず、お知らせの「更新する」を押したときに切り替える。開いたままの端末でも気づけるよう、
 * 画面が見えている間は1時間ごとに新しい版を確かめる。GAS版には無い(GASは開くたびに最新になる)。
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => {
        if (document.visibilityState !== 'visible' || !navigator.onLine) return;
        void registration.update();
      }, SW_UPDATE_CHECK_INTERVAL_MS);
    },
    onRegisterError(error) {
      console.error('Service Worker を登録できませんでした', error);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    showActionToast(UPDATE_AVAILABLE_MESSAGE, {
      label: UPDATE_ACTION_LABEL,
      run: () => void updateServiceWorker(true),
    });
  }, [needRefresh, updateServiceWorker]);

  return null;
}
