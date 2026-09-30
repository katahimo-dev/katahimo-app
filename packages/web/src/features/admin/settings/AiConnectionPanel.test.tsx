import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../../api/client';
import { settingsApi } from '../../../api/settings';
import { createWrapper, deferred } from '../../../test/providers';
import { showErrorToast, showToast } from '../../../ui/toast';
import { AiConnectionPanel } from './AiConnectionPanel';

vi.mock('../../../api/settings', () => ({
  settingsApi: { get: vi.fn(), saveGeminiApiKey: vi.fn(), saveGchatWebhooks: vi.fn() },
}));
vi.mock('../../../ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ui/toast')>()),
  showToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

const api = vi.mocked(settingsApi);

const REJECTED =
  'Gemini API キーを確認できませんでした。キーが正しいか確認して、入力し直してください(キーは保存していません)。';
const UNVERIFIED =
  'Gemini に接続できず、API キーを確認できませんでした(キーは保存していません)。しばらくしてから、もう一度保存してください。';

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({
    settings: {
      geminiApiKey: '••••••••abcd',
      geminiApiKeySet: true,
      gchatReportWebhookUrl: '',
      gchatReportWebhookUrlSet: false,
      gchatReceiptWebhookUrl: '',
      gchatReceiptWebhookUrlSet: false,
    },
  });
});

async function renderPanel() {
  render(<AiConnectionPanel />, { wrapper: createWrapper() });
  const input = (await screen.findByLabelText('Gemini APIキー')) as HTMLInputElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}

describe('APIキー: 保存の前の Gemini での確認', () => {
  it('確かめている間は「確認中...」、断られたら入力を残して入力欄の下に文言を出し、入力し直すと消す', async () => {
    const pending = deferred<never>();
    api.saveGeminiApiKey.mockReturnValue(pending.promise);
    const input = await renderPanel();
    fireEvent.change(input, { target: { value: 'AIza-wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    const busy = await screen.findByRole('button', { name: '確認中...' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    pending.reject(
      new ApiRequestError(400, {
        code: 'validation_failed',
        message: REJECTED,
        fields: { apiKey: REJECTED },
      }),
    );
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', REJECTED);
    expect(input.value).toBe('AIza-wrong');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('保存していない変更があります')).toBeTruthy();
    expect(showErrorToast).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith('APIキーを保存しました');
    expect(screen.getByRole('button', { name: '保存する' })).toBeTruthy();

    fireEvent.change(input, { target: { value: 'AIza-right' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('Gemini につながらない(502)ときも、保存していないことと、あとで試す文言を入力欄の下に出す', async () => {
    api.saveGeminiApiKey.mockRejectedValue(
      new ApiRequestError(502, { code: 'upstream_unavailable', message: UNVERIFIED }),
    );
    const input = await renderPanel();
    fireEvent.change(input, { target: { value: 'AIza-maybe' } });
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', UNVERIFIED);
    expect(input.value).toBe('AIza-maybe');
  });

  it('使えるキーなら保存してお知らせを出す(エラーの文言は出さない)', async () => {
    api.saveGeminiApiKey.mockResolvedValue({ ok: true, changed: true, message: '' });
    const input = await renderPanel();
    fireEvent.change(input, { target: { value: 'AIza-good' } });
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('APIキーを保存しました'));
    expect(api.saveGeminiApiKey).toHaveBeenCalledWith('AIza-good');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
