import type { AdminStaffView } from '@katahimo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { adminStaffApi } from '../../../api/admin';
import { userMessageOf } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { useFileDownload } from '../../../lib/useFileDownload';
import { useConfirmModal } from '../../../ui/confirm';
import { EmptyState, ErrorState, Loading } from '../../../ui/StatusViews';
import { showErrorToast, showToast } from '../../../ui/toast';
import { useSession } from '../../auth';
import { adminQueryKeys } from '../adminQueryKeys';
import { ICON_BUTTON, INPUT_CLASS, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../components/FormField';
import { StaffFormModal } from './StaffFormModal';
import { StaffImportPanel } from './StaffImportPanel';
import { filterStaff, PASSWORD_STATUS_LABELS, ROLE_LABELS } from './staffModel';
import { useAdminStaffList, useAdminStaffMutations } from './useAdminStaff';

function Badge({ tone, children }: { tone: 'blue' | 'gray' | 'amber' | 'red' | 'green'; children: string }) {
  const tones = {
    blue: 'bg-blue-100 text-blue-800',
    gray: 'bg-gray-200 text-gray-800',
    amber: 'bg-amber-100 text-amber-900',
    red: 'bg-red-100 text-red-800',
    green: 'bg-green-100 text-green-800',
  } as const;
  return (
    <span className={`inline-block px-1.5 py-px rounded text-xs font-bold whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** 一覧の1行(氏名・メール・状態のバッジ、右に編集・案内メールのアイコン)。 */
function StaffRow({
  staff,
  onEdit,
  onSendGuide,
  sendingGuide,
}: {
  staff: AdminStaffView;
  onEdit: (staff: AdminStaffView) => void;
  onSendGuide: (staff: AdminStaffView) => void;
  sendingGuide: boolean;
}) {
  const canSendGuide = !staff.isRetired && staff.passwordStatus !== 'set';
  return (
    <li className={`flex items-center gap-2 px-3 py-2 ${staff.isRetired ? 'bg-gray-50 text-gray-500' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="font-bold text-gray-800 text-sm">{staff.name}</h3>
          {staff.kana ? <span className="text-xs text-gray-500">{staff.kana}</span> : null}
          <span className="text-xs text-gray-600 break-all">{staff.email}</span>
        </div>
        <div className="flex flex-wrap gap-1 mt-0.5">
          {staff.role !== 'staff' ? <Badge tone="blue">{ROLE_LABELS[staff.role]}</Badge> : null}
          {staff.isRetired ? <Badge tone="gray">{`退職（${staff.retiredOn}）`}</Badge> : null}
          {!staff.isRetired && staff.retiredOn ? (
            <Badge tone="amber">{`${staff.retiredOn} 退職予定`}</Badge>
          ) : null}
          {staff.passwordStatus !== 'set' ? (
            <Badge tone="amber">{PASSWORD_STATUS_LABELS[staff.passwordStatus]}</Badge>
          ) : null}
          {!staff.homeAddress ? <Badge tone="red">自宅住所なし</Badge> : null}
          {staff.homeAddress && !staff.hasHomeGeo ? <Badge tone="amber">自宅の位置が未確定</Badge> : null}
        </div>
      </div>
      {canSendGuide ? (
        <button
          type="button"
          onClick={() => onSendGuide(staff)}
          disabled={sendingGuide}
          aria-label={`${staff.name}さんにパスワード設定の案内メールを送る`}
          title="パスワード設定の案内メールを送る"
          className={ICON_BUTTON}
        >
          ✉️
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onEdit(staff)}
        aria-label={`${staff.name}さんを編集`}
        title="編集"
        className={ICON_BUTTON}
      >
        ✏️
      </button>
    </li>
  );
}

/**
 * 管理画面「スタッフ」(GAS版でスタッフ台帳シートを直接編集していた作業)。1人1行の一覧(編集・案内メールはアイコン)、
 * Excel(.xlsx)での書き出し・取込(CSV は Excel で開くと文字化けしやすいため)。
 */
export function StaffAdminPanel() {
  const { user } = useSession();
  const confirm = useConfirmModal();
  const list = useAdminStaffList();
  const { sendPasswordGuide } = useAdminStaffMutations();
  const [search, setSearch] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();
  const download = useFileDownload<'xlsx'>();
  /** 編集するスタッフ(null は新規登録)。閉じた後も消さない(閉じる間のフェードで表示が変わらないように)。 */
  const [formStaff, setFormStaff] = useState<AdminStaffView | null>(null);
  const openForm = (target: AdminStaffView | null) => {
    setFormStaff(target);
    setFormOpen(true);
  };

  const staff = list.data?.staff;
  const shown = useMemo(() => filterStaff(staff ?? [], search, showRetired), [staff, search, showRetired]);
  const retiredCount = staff?.filter((s) => s.isRetired).length ?? 0;

  const sendGuide = async (target: AdminStaffView) => {
    const ok = await confirm({
      title: `${target.name}さん（${target.email}）にパスワード設定の案内メールを送りますか？`,
      confirmLabel: '送る',
    });
    if (!ok) return;
    try {
      await sendPasswordGuide.mutateAsync(target.id);
      showToast('案内のメールを送りました');
    } catch (error) {
      showErrorToast(error);
    }
  };

  return (
    <section aria-labelledby="adminStaffHeading" className="space-y-3">
      <h2 id="adminStaffHeading" className="sr-only">
        スタッフ
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="スタッフを探す(氏名・カナ・メール)"
          placeholder="氏名・カナ・メールで探す"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${INPUT_CLASS} flex-1 min-w-[12rem] w-auto`}
        />
        <button type="button" onClick={() => openForm(null)} className={PRIMARY_BUTTON}>
          ＋ 登録
        </button>
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          aria-expanded={importOpen}
          className={SECONDARY_BUTTON}
        >
          ⬆ Excel取込
        </button>
        <button
          type="button"
          onClick={() =>
            void download.run('xlsx', adminStaffApi.downloadXlsx, 'スタッフ一覧をExcelで保存しました')
          }
          disabled={download.busy !== null}
          className={SECONDARY_BUTTON}
        >
          ⬇ Excel
        </button>
      </div>
      {importOpen ? (
        <StaffImportPanel
          onClose={() => setImportOpen(false)}
          onImported={() => {
            void queryClient.invalidateQueries({ queryKey: adminQueryKeys.staff });
            void queryClient.invalidateQueries({ queryKey: queryKeys.activeStaff });
            void queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogsAll });
            void queryClient.invalidateQueries({ queryKey: queryKeys.session });
          }}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
            className="w-4 h-4"
          />
          退職者も表示する{retiredCount > 0 ? `（${retiredCount}人）` : ''}
        </label>
        <div className="flex items-center gap-1">
          {staff ? <span className="text-xs text-gray-600">{`${shown.length}人`}</span> : null}
          <button
            type="button"
            onClick={() => void list.refetch()}
            disabled={list.isFetching}
            aria-label="読み込み直す"
            title="読み込み直す"
            className={ICON_BUTTON}
          >
            🔄
          </button>
        </div>
      </div>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState message={userMessageOf(list.error)} />
      ) : shown.length === 0 ? (
        <EmptyState icon="👤" title="該当するスタッフはいません" />
      ) : (
        <ul
          className="divide-y divide-gray-100 bg-white rounded-xl border border-gray-200"
          aria-label="スタッフの一覧"
        >
          {shown.map((s) => (
            <StaffRow
              key={s.id}
              staff={s}
              onEdit={openForm}
              onSendGuide={(target) => void sendGuide(target)}
              sendingGuide={sendPasswordGuide.isPending}
            />
          ))}
        </ul>
      )}

      <StaffFormModal
        open={formOpen}
        staff={formStaff}
        isSelf={formStaff?.id === user.staffId}
        onClose={() => setFormOpen(false)}
      />
    </section>
  );
}
