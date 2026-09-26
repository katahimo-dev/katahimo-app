import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attendanceApi } from '../../../api/attendance';
import { ApiRequestError } from '../../../api/client';
import { saveBlobAsFile } from '../../../lib/saveFile';
import { createWrapper, deferred, TEST_USER } from '../../../test/providers';
import { showErrorToast, showToast } from '../../../ui/toast';
import { fiscalYearOf } from '../hooks/useAttendanceExport';
import { ExcelExportButtons } from './ExcelExportButtons';

vi.mock('../../../api/attendance', () => ({ attendanceApi: { exportStaff: vi.fn(), exportAll: vi.fn() } }));
vi.mock('../../../lib/saveFile', () => ({ saveBlobAsFile: vi.fn() }));
vi.mock('../../../ui/toast', () => ({ showToast: vi.fn(), showErrorToast: vi.fn() }));
vi.mock('../hooks/attendanceQueries', () => ({
  useAttendanceTarget: () => ({ staffKey: 'target-staff', staffId: 'target-staff' }),
}));

const file = { blob: new Blob(['x']), filename: '出勤簿_2026年9月_山田.xlsx' };

function renderButtons(role: 'staff' | 'coordinator' | 'admin', yearMonth = '2026-09') {
  const Wrapper = createWrapper({ user: { ...TEST_USER, role } });
  return render(
    <Wrapper>
      <ExcelExportButtons yearMonth={yearMonth} />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.mocked(attendanceApi.exportStaff).mockResolvedValue(file);
  vi.mocked(attendanceApi.exportAll).mockResolvedValue(file);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('今月のまとめの「Excelで保存」', () => {
  it('選んだ月を、表示しているスタッフの分で保存する', async () => {
    renderButtons('staff');
    fireEvent.click(screen.getByRole('button', { name: '⬇ Excelで保存' }));
    await waitFor(() => expect(saveBlobAsFile).toHaveBeenCalledWith(file.blob, file.filename));
    expect(attendanceApi.exportStaff).toHaveBeenCalledWith({ month: '2026-09' }, 'target-staff');
    expect(showToast).toHaveBeenCalledWith('Excelファイルを保存しました');
  });

  it('年度分は選んだ月の年度(1〜3月は前の年の年度)', async () => {
    renderButtons('staff', '2027-02');
    fireEvent.click(screen.getByRole('button', { name: '⬇ 2026年度分' }));
    await waitFor(() => expect(saveBlobAsFile).toHaveBeenCalled());
    expect(attendanceApi.exportStaff).toHaveBeenCalledWith({ fiscalYear: 2026 }, 'target-staff');
    expect(fiscalYearOf('2026-04')).toBe(2026);
    expect(fiscalYearOf('2026-03')).toBe(2025);
  });

  it('全員分のボタンは管理者だけに出る', async () => {
    const { unmount } = renderButtons('staff');
    expect(screen.queryByRole('button', { name: '⬇ 全員分をExcelで保存' })).toBeNull();
    unmount();
    const coordinator = renderButtons('coordinator');
    expect(screen.queryByRole('button', { name: '⬇ 全員分をExcelで保存' })).toBeNull();
    coordinator.unmount();
    renderButtons('admin');
    fireEvent.click(screen.getByRole('button', { name: '⬇ 全員分をExcelで保存' }));
    await waitFor(() => expect(saveBlobAsFile).toHaveBeenCalled());
    expect(attendanceApi.exportAll).toHaveBeenCalledWith('2026-09');
  });

  it('保存している間はボタンを押せず、2回目は送らない', async () => {
    const pending = deferred<typeof file>();
    vi.mocked(attendanceApi.exportStaff).mockReturnValue(pending.promise);
    renderButtons('staff');
    fireEvent.click(screen.getByRole('button', { name: '⬇ Excelで保存' }));
    const busy = await screen.findByRole('button', { name: '保存しています…' });
    expect(busy).toHaveProperty('disabled', true);
    fireEvent.click(busy);
    expect(attendanceApi.exportStaff).toHaveBeenCalledTimes(1);
    pending.resolve(file);
    await screen.findByRole('button', { name: '⬇ Excelで保存' });
  });

  it('断られたらサーバーの理由を赤いお知らせで出し、ファイルは保存しない', async () => {
    const error = new ApiRequestError(
      429,
      { code: 'rate_limited', message: '回数が上限に達しました。' },
      900,
    );
    vi.mocked(attendanceApi.exportStaff).mockRejectedValue(error);
    renderButtons('staff');
    fireEvent.click(screen.getByRole('button', { name: '⬇ Excelで保存' }));
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith(error));
    expect(saveBlobAsFile).not.toHaveBeenCalled();
  });

  it('月が選ばれていなければ案内だけ', () => {
    renderButtons('staff', '');
    fireEvent.click(screen.getByRole('button', { name: '⬇ Excelで保存' }));
    expect(showToast).toHaveBeenCalledWith('月を選んでください', true);
    expect(attendanceApi.exportStaff).not.toHaveBeenCalled();
  });
});
