import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTargetStaffProvider } from '../../../app/adminTargetStaff';
import { createWrapper } from '../../../test/providers';
import { useAttendanceMonth } from '../hooks/attendanceQueries';
import { MonthlyModal } from './MonthlyModal';

vi.mock('../hooks/attendanceQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/attendanceQueries')>()),
  useAttendanceMonth: vi.fn(() => ({ data: undefined, isSuccess: false, isError: false, isFetching: true })),
  useAttendanceInvalidation: () => ({ reloadMonth: vi.fn() }),
}));

const monthHook = vi.mocked(useAttendanceMonth);

function renderModal(open: boolean) {
  const Wrapper = createWrapper();
  const props = { onClose: vi.fn(), onOpenSlot: vi.fn(), onOpenReceipts: vi.fn() };
  const view = render(
    <Wrapper>
      <AdminTargetStaffProvider>
        <MonthlyModal open={open} {...props} />
      </AdminTargetStaffProvider>
    </Wrapper>,
  );
  const rerender = (next: boolean) =>
    view.rerender(
      <Wrapper>
        <AdminTargetStaffProvider>
          <MonthlyModal open={next} {...props} />
        </AdminTargetStaffProvider>
      </Wrapper>,
    );
  const monthInput = () => view.container.querySelector<HTMLInputElement>('#attendanceMonthlyMonth');
  return { rerender, monthInput };
}

const lastRequestedMonth = () => monthHook.mock.calls.at(-1)?.[0];

describe('今月のまとめの月(開いたまま月をまたいだとき)', () => {
  beforeEach(() => {
    monthHook.mockClear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z')); // 2026-09-30 21:00(JST)
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('自動で入れた今月のままなら、開き直したとき今の月にする', () => {
    const { rerender, monthInput } = renderModal(true);
    expect(monthInput()?.value).toBe('2026-09');
    rerender(false);
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z')); // 2026-10-01 09:00(JST)
    rerender(true);
    expect(monthInput()?.value).toBe('2026-10');
    expect(lastRequestedMonth()).toBe('2026-10');
  });

  it('自分で選び直した月は、開き直しても残す', () => {
    const { rerender, monthInput } = renderModal(true);
    const input = monthInput();
    if (!input) throw new Error('月の欄がない');
    act(() => {
      fireEvent.change(input, { target: { value: '2026-08' } });
    });
    rerender(false);
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    rerender(true);
    expect(monthInput()?.value).toBe('2026-08');
    expect(lastRequestedMonth()).toBe('2026-08');
  });
});
