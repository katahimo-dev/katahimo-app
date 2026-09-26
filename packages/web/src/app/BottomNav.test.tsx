import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createWrapper, TEST_USER } from '../test/providers';
import { BottomNav } from './BottomNav';
import { HomeTabsProvider, useHomeTabs } from './homeTabs';

function ActiveTab() {
  return <output>{useHomeTabs().activeTab}</output>;
}

function renderNav(role: 'staff' | 'coordinator' | 'admin') {
  const Wrapper = createWrapper({ user: { ...TEST_USER, role } });
  return render(
    <Wrapper>
      <HomeTabsProvider>
        <BottomNav />
        <ActiveTab />
      </HomeTabsProvider>
    </Wrapper>,
  );
}

describe('下タブ', () => {
  it('管理者には「🛠 管理」を加えた4つを出し、押すと管理タブになる', () => {
    renderNav('admin');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '📅今日の予定',
      '👪お客様',
      '🕒出勤簿',
      '🛠管理',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /管理/ }));
    expect(screen.getByRole('status').textContent).toBe('admin');
  });

  it('一般スタッフ・コーディネーターには管理タブを出さない', () => {
    renderNav('coordinator');
    expect(screen.queryByRole('button', { name: /管理/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});
