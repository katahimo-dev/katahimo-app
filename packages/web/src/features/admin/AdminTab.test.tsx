import { AI_PROMPT_DEFINITIONS, type AiPromptView, type AuditLogListResponse } from '@katahimo/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminStaffApi, aiPromptsApi, auditLogsApi } from '../../api/admin';
import { ApiRequestError } from '../../api/client';
import { createWrapper, TEST_USER } from '../../test/providers';
import { showErrorToast, showToast } from '../../ui/toast';
import { AdminTab } from './AdminTab';
import { adminStaff } from './adminFixtures.test-helper';

vi.mock('../../api/admin', () => ({
  adminStaffApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    sendPasswordGuide: vi.fn(),
  },
  aiPromptsApi: { list: vi.fn(), save: vi.fn() },
  auditLogsApi: { list: vi.fn(), csvUrl: vi.fn(() => '/api/admin/audit-logs.csv') },
}));
vi.mock('../../ui/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui/toast')>()),
  showToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

const staffApi = vi.mocked(adminStaffApi);
const promptsApi = vi.mocked(aiPromptsApi);
const logsApi = vi.mocked(auditLogsApi);

const self = adminStaff({ id: TEST_USER.staffId, name: TEST_USER.name, role: 'admin', kana: null });
const hanako = adminStaff();
const newcomer = adminStaff({
  id: '00000000-0000-4000-8000-00000000b002',
  name: '新人 次郎',
  kana: null,
  email: 'jiro@example.com',
  passwordStatus: 'unset',
  homeAddress: null,
  hasHomeGeo: false,
});
const retired = adminStaff({
  id: '00000000-0000-4000-8000-00000000b003',
  name: '退職 三郎',
  kana: null,
  email: 'saburo@example.com',
  isRetired: true,
  retiredOn: '2026-03-31',
});

function prompts(): AiPromptView[] {
  return AI_PROMPT_DEFINITIONS.slice(0, 2).map((d, i) => ({
    key: d.key,
    kind: d.kind,
    label: d.label,
    body: i === 0 ? '独自の指示' : d.defaultBody,
    defaultBody: d.defaultBody,
    customized: i === 0,
    updatedAt: null,
    revision: i === 0 ? 4 : 0,
  }));
}

function renderAdmin() {
  const Wrapper = createWrapper();
  return render(
    <Wrapper>
      <AdminTab />
    </Wrapper>,
  );
}

/** 確認ダイアログの右のボタンを押す。 */
async function acceptConfirm(label: string) {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
}

beforeEach(() => {
  vi.resetAllMocks();
  logsApi.csvUrl.mockReturnValue('/api/admin/audit-logs.csv');
  staffApi.list.mockResolvedValue({ staff: [self, hanako, newcomer, retired] });
});

describe('管理タブ: スタッフ', () => {
  it('在籍者を一覧にし、役割・パスワード・自宅住所のバッジを出す。退職者は切り替えで出し、名前で探せる', async () => {
    renderAdmin();
    const list = await screen.findByRole('list', { name: 'スタッフの一覧' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('管理者')).toBeTruthy();
    expect(within(list).getByText('パスワード未設定')).toBeTruthy();
    expect(within(list).getByText('自宅住所なし')).toBeTruthy();
    expect(screen.queryByText('退職 三郎')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: /退職者も表示する/ }));
    expect(screen.getByText('退職 三郎')).toBeTruthy();
    expect(screen.getByText('退職（2026-03-31）')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: /スタッフを探す/ }), {
      target: { value: 'サトウ' },
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('登録: サーバーの入力の誤りを項目の下に出し、直して登録すると一覧を読み直す', async () => {
    staffApi.create.mockRejectedValueOnce(
      new ApiRequestError(409, {
        code: 'conflict',
        message: 'このメールアドレスは他のスタッフが使用しています',
        fields: { email: 'このメールアドレスは他のスタッフが使用しています' },
      }),
    );
    staffApi.create.mockResolvedValueOnce({ staff: newcomer, homeGeocode: 'not_found' });
    renderAdmin();
    fireEvent.click(await screen.findByRole('button', { name: '＋ 登録' }));
    const dialog = await screen.findByRole('dialog', { name: 'スタッフの登録' });
    fireEvent.change(within(dialog).getByLabelText(/^氏名/), { target: { value: '新人 次郎' } });
    fireEvent.change(within(dialog).getByLabelText(/^メールアドレス/), {
      target: { value: 'hanako@example.com' },
    });
    fireEvent.change(within(dialog).getByLabelText('自宅住所'), { target: { value: '不明な住所' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '登録する' }));

    const email = within(dialog).getByLabelText(/^メールアドレス/);
    await waitFor(() => expect(email.getAttribute('aria-invalid')).toBe('true'));
    expect(
      within(dialog).getAllByText('このメールアドレスは他のスタッフが使用しています').length,
    ).toBeGreaterThan(0);
    expect(staffApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '新人 次郎', homeAddress: '不明な住所', kana: null, role: 'staff' }),
    );

    fireEvent.change(email, { target: { value: 'jiro@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '登録する' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('場所が地図で見つかりませんでした'),
        true,
      ),
    );
    await waitFor(() => expect(staffApi.list).toHaveBeenCalledTimes(2));
  });

  it('編集: 変えた項目だけを版と一緒に送る。自分自身は役割・退職日を変えられず、削除も出さない', async () => {
    staffApi.update.mockResolvedValue({ staff: { ...hanako, phone: '090' }, homeGeocode: null });
    renderAdmin();
    fireEvent.click(await screen.findByRole('button', { name: '佐藤 花子さんを編集' }));
    let dialog = await screen.findByRole('dialog', { name: 'スタッフの編集' });
    fireEvent.change(within(dialog).getByLabelText('電話'), { target: { value: '090' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '今日で退職' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '保存する' }));
    await waitFor(() =>
      expect(staffApi.update).toHaveBeenCalledWith(hanako.id, {
        phone: '090',
        retiredOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        rowVersion: 3,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: `${self.name}さんを編集` }));
    dialog = await screen.findByRole('dialog', { name: 'スタッフの編集' });
    expect((within(dialog).getByLabelText('役割') as HTMLSelectElement).disabled).toBe(true);
    expect((within(dialog).getByLabelText('退職日') as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).queryByRole('button', { name: /削除/ })).toBeNull();
  });

  it('削除: 確認してから消し、記録があって断られたら理由(退職日の案内)を出す', async () => {
    staffApi.remove.mockRejectedValueOnce(
      new ApiRequestError(409, {
        code: 'conflict',
        message: '記録があるため削除できません。退職日を設定してください。',
      }),
    );
    renderAdmin();
    fireEvent.click(await screen.findByRole('button', { name: '佐藤 花子さんを編集' }));
    const dialog = await screen.findByRole('dialog', { name: 'スタッフの編集' });
    fireEvent.click(within(dialog).getByRole('button', { name: /このスタッフを削除する/ }));
    await acceptConfirm('削除する');
    await waitFor(() => expect(staffApi.remove).toHaveBeenCalledWith(hanako.id));
    expect(showErrorToast).toHaveBeenCalledWith(expect.objectContaining({ code: 'conflict' }));
  });

  it('パスワード設定の案内は未設定・GAS版のパスワードの在籍者だけに出し、確認してから送る', async () => {
    staffApi.sendPasswordGuide.mockResolvedValue({ ok: true });
    renderAdmin();
    await screen.findByRole('list', { name: 'スタッフの一覧' });
    expect(screen.getAllByRole('button', { name: /パスワード設定の案内メールを送る/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '新人 次郎さんにパスワード設定の案内メールを送る' }));
    await acceptConfirm('送る');
    await waitFor(() => expect(staffApi.sendPasswordGuide).toHaveBeenCalledWith(newcomer.id));
    expect(showToast).toHaveBeenCalledWith('案内のメールを送りました');
  });
});

describe('管理タブ: AIプロンプト', () => {
  it('変えたものだけを版と一緒に保存し、既定に戻すと既定の本文になる。保存前に表示を移るときは確かめる', async () => {
    const list = prompts();
    promptsApi.list.mockResolvedValue({ prompts: list });
    promptsApi.save.mockResolvedValue({ prompts: list });
    renderAdmin();
    fireEvent.click(screen.getByRole('tab', { name: '🤖 AIプロンプト' }));
    const first = (await screen.findByLabelText(list[0]?.label ?? '')) as HTMLTextAreaElement;
    expect(first.value).toBe('独自の指示');
    expect(screen.getByText('変更済み')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: '既定に戻す' })[0] as HTMLElement);
    expect(first.value).toBe(list[0]?.defaultBody);
    expect(screen.getByText('未保存')).toBeTruthy();

    // 保存していない変更があるまま移ろうとすると確かめる(やめれば残る)
    fireEvent.click(screen.getByRole('tab', { name: '📄 操作ログ' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    expect(screen.getByRole('tab', { name: '🤖 AIプロンプト' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '保存する（1件）' }));
    await waitFor(() =>
      expect(promptsApi.save).toHaveBeenCalledWith({
        prompts: [{ key: list[0]?.key, body: list[0]?.defaultBody, revision: 4 }],
      }),
    );
    expect(showToast).toHaveBeenCalledWith('AIプロンプトを保存しました');
  });

  it('他の管理者が先に保存していた(409)ときは入力を残して理由を出す', async () => {
    const list = prompts();
    promptsApi.list.mockResolvedValue({ prompts: list });
    promptsApi.save.mockRejectedValue(
      new ApiRequestError(409, {
        code: 'conflict',
        message: '他の管理者が先にこのプロンプトを保存しました。',
      }),
    );
    renderAdmin();
    fireEvent.click(screen.getByRole('tab', { name: '🤖 AIプロンプト' }));
    const first = (await screen.findByLabelText(list[0]?.label ?? '')) as HTMLTextAreaElement;
    fireEvent.change(first, { target: { value: '書きかけ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存する（1件）' }));
    expect(await screen.findByText('他の管理者が先にこのプロンプトを保存しました。')).toBeTruthy();
    expect(first.value).toBe('書きかけ');
  });
});

describe('管理タブ: 操作ログ', () => {
  const page = (cursor: string | null, action: string): AuditLogListResponse => ({
    entries: [
      {
        id: cursor ? '00000000-0000-4000-8000-00000000c001' : '00000000-0000-4000-8000-00000000c002',
        createdAt: '2026-09-25T01:02:03.000Z',
        level: 'SECURITY',
        action,
        actorType: 'staff',
        actorStaffId: self.id,
        actorName: self.name,
        targetStaffId: hanako.id,
        targetName: null,
        details: { changedFields: ['phone', 'role'], role: 'admin' },
        ip: '203.0.113.1',
        userAgent: null,
        requestId: null,
      },
    ],
    nextCursor: cursor,
    range: { from: '2026-09-19', to: '2026-09-25' },
    timeZone: 'Asia/Tokyo',
  });

  it('日本語の操作名・時刻(テナントのタイムゾーン)・操作者→対象・詳細を出し、「もっと見る」で続きを読む', async () => {
    logsApi.list.mockResolvedValueOnce(page('next-1', 'staff.admin.updated'));
    logsApi.list.mockResolvedValueOnce(page(null, 'custom.unknown_action'));
    renderAdmin();
    fireEvent.click(screen.getByRole('tab', { name: '📄 操作ログ' }));
    expect(await screen.findByText('スタッフ情報の変更')).toBeTruthy();
    expect(screen.getByText('2026-09-25 10:02:03')).toBeTruthy();
    expect(screen.getByText(`${self.name} → (削除されたスタッフ)`)).toBeTruthy();
    expect(screen.getByText('changedFields: phone・role, role: admin')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: '操作ログ' })).getByText('セキュリティ')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'もっと見る' }));
    // 表示名の無い操作コードはそのまま出す
    expect((await screen.findAllByText('custom.unknown_action')).length).toBeGreaterThan(0);
    expect(logsApi.list).toHaveBeenLastCalledWith(expect.any(Object), 'next-1', expect.anything());
    expect(screen.queryByRole('button', { name: 'もっと見る' })).toBeNull();
  });

  it('条件を変えて「絞り込む」で読み直し、CSV は同じ条件のリンク', async () => {
    logsApi.list.mockResolvedValue(page(null, 'auth.login.failed'));
    renderAdmin();
    fireEvent.click(screen.getByRole('tab', { name: '📄 操作ログ' }));
    await screen.findByText('ログインの失敗');
    fireEvent.change(screen.getByLabelText('レベル'), { target: { value: 'WARN' } });
    fireEvent.change(screen.getByLabelText('操作の種類'), { target: { value: 'auth.' } });
    fireEvent.click(screen.getByRole('button', { name: '絞り込む' }));
    await waitFor(() =>
      expect(logsApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ level: 'WARN', action: 'auth.' }),
        undefined,
        expect.anything(),
      ),
    );
    expect(logsApi.csvUrl).toHaveBeenLastCalledWith(
      expect.objectContaining({ level: 'WARN', action: 'auth.' }),
    );
    expect(screen.getByRole('link', { name: '⬇ CSVで保存' }).getAttribute('href')).toBe(
      '/api/admin/audit-logs.csv',
    );
  });
});
