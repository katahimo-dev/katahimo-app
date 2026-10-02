import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWrapper, TEST_USER } from '../../test/providers';
import { CustomersTab } from './CustomersTab';
import { CustomerSearchProvider } from './customerSearchStore';

vi.mock('./useCustomerList', () => ({
  useCustomerList: () => ({ data: { customers: [], cities: [] }, error: null, errorUpdateCount: 0 }),
}));
vi.mock('../report', () => ({
  useReportModal: () => ({ openReport: vi.fn(), openStandaloneReceipt: vi.fn() }),
}));

function renderTab(user: typeof TEST_USER) {
  const Wrapper = createWrapper({ user });
  return render(
    <Wrapper>
      <CustomerSearchProvider>
        <CustomersTab />
      </CustomerSearchProvider>
    </Wrapper>,
  );
}

describe('お客様タブ: お客様の情報を今すぐ取り込む', () => {
  it('管理者・コーディネーターには出す', () => {
    renderTab({ ...TEST_USER, role: 'coordinator' });
    expect(screen.getByRole('button', { name: '🔄 お客様の情報を今すぐ取り込む' })).toBeTruthy();
  });

  it('一般スタッフには出さない', () => {
    renderTab({ ...TEST_USER, role: 'staff' });
    expect(screen.queryByRole('button', { name: '🔄 お客様の情報を今すぐ取り込む' })).toBeNull();
  });

  it('公開デモのテナントでは管理者にも出さない(API が断るため)', () => {
    renderTab({ ...TEST_USER, demoTenant: true });
    expect(screen.queryByRole('button', { name: '🔄 お客様の情報を今すぐ取り込む' })).toBeNull();
  });
});
