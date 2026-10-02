import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWrapper, TEST_USER } from '../../test/providers';
import { SettingsModal } from './SettingsModal';

// 通知・文字の大きさの欄は端末・サーバーの設定を読むので、ここでは出さない
vi.mock('../notifications', () => ({ NotificationSettingsSection: () => null }));
vi.mock('./TextSizeOptions', () => ({ TextSizeOptions: () => null }));

function renderSettings(demoTenant: boolean) {
  const Wrapper = createWrapper({ user: { ...TEST_USER, demoTenant } });
  return render(
    <Wrapper>
      <SettingsModal open onClose={() => undefined} onOpenChangePassword={() => undefined} />
    </Wrapper>,
  );
}

describe('設定ダイアログ: 公開デモ', () => {
  it('ふだんは「パスワード変更」を出す', () => {
    renderSettings(false);
    expect(screen.getByRole('button', { name: 'パスワード変更' })).toBeTruthy();
  });

  it('デモ用テナントでは「パスワード変更」を出さない(共有のアカウントのため API も断る)', () => {
    renderSettings(true);
    expect(screen.queryByRole('button', { name: 'パスワード変更' })).toBeNull();
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeTruthy();
  });
});
