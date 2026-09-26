import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminTargetStaffProvider, useAdminTargetStaff } from '../../app/adminTargetStaff';
import { HomeTabsProvider, useHomeTabs } from '../../app/homeTabs';
import { createWrapper, TEST_USER } from '../../test/providers';
import { NOTIFICATION_CLICK_MESSAGE, onScheduleLink } from './scheduleLink';
import { useScheduleLinkNavigation } from './useScheduleLinkNavigation';

function setup() {
  const serviceWorker = new EventTarget();
  vi.stubGlobal('navigator', { ...navigator, serviceWorker });
  const Base = createWrapper();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Base>
      <HomeTabsProvider>
        <AdminTargetStaffProvider>{children}</AdminTargetStaffProvider>
      </HomeTabsProvider>
    </Base>
  );
  const hook = renderHook(
    () => {
      useScheduleLinkNavigation();
      return { tabs: useHomeTabs(), target: useAdminTargetStaff() };
    },
    { wrapper },
  );
  const click = (url: string) =>
    act(() => {
      serviceWorker.dispatchEvent(
        new MessageEvent('message', { data: { type: NOTIFICATION_CLICK_MESSAGE, url } }),
      );
    });
  return { hook, click };
}

describe('通知から予定タブを開く', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('開いている画面で通知を押したら、予定タブに切り替え、表示するスタッフを本人に戻してその日を知らせる', () => {
    const { hook, click } = setup();
    const linked = vi.fn();
    const off = onScheduleLink(linked);
    act(() => {
      hook.result.current.tabs.switchTab('visitors');
      hook.result.current.target.setTargetStaffId('00000000-0000-4000-8000-00000000b002');
    });
    expect(hook.result.current.target.targetStaffId).not.toBe(TEST_USER.staffId);

    click('/?schedule=2026-09-27');
    expect(hook.result.current.tabs.activeTab).toBe('schedule');
    expect(hook.result.current.target.targetStaffId).toBe(TEST_USER.staffId);
    expect(linked).toHaveBeenCalledWith('2026-09-27');
    off();
  });

  it('予定のリンクでないメッセージは無視する', () => {
    const { hook, click } = setup();
    act(() => hook.result.current.tabs.switchTab('visitors'));
    click('/');
    expect(hook.result.current.tabs.activeTab).toBe('visitors');
  });
});
