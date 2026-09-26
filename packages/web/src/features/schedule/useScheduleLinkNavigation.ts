import { useEffect } from 'react';
import { useHomeTabs } from '../../app/homeTabs';
import { openScheduleLink, scheduleLinkDateOfMessage, urlWithoutScheduleLink } from './scheduleLink';

/**
 * 通知(翌日の予定のお知らせ)から予定タブを開く(画面の骨格が1回だけ使う)。
 * 起動時のリンクは予定タブが最初の描画で読むので、ここでは URL から取り除くだけにする(再読み込みで同じ日に戻らないように)。
 * 開いている画面で通知を押したときは Service Worker のメッセージを受け、予定タブに切り替えてその日を開く。
 */
export function useScheduleLinkNavigation(): void {
  const { switchTab } = useHomeTabs();

  useEffect(() => {
    const cleaned = urlWithoutScheduleLink(window.location.href);
    if (cleaned !== null) window.history.replaceState(window.history.state, '', cleaned);
  }, []);

  useEffect(() => {
    const serviceWorker = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    if (!serviceWorker) return;
    const onMessage = (event: MessageEvent) => {
      const date = scheduleLinkDateOfMessage(event.data, window.location.origin);
      if (!date) return;
      switchTab('schedule');
      openScheduleLink(date);
    };
    serviceWorker.addEventListener('message', onMessage);
    return () => serviceWorker.removeEventListener('message', onMessage);
  }, [switchTab]);
}
