import type { AdminStaffView } from '@katahimo/shared';
import { useMemo, useState } from 'react';
import { userMessageOf } from '../../../api/client';
import { useConfirmModal } from '../../../ui/confirm';
import { EmptyState, ErrorState, Loading } from '../../../ui/StatusViews';
import { showErrorToast, showToast } from '../../../ui/toast';
import { useSession } from '../../auth';
import { INPUT_CLASS } from '../components/FormField';
import { StaffFormModal } from './StaffFormModal';
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
    <span className={`inline-block px-2 py-0.5 rounded-full text-sm font-bold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function StaffCard({
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
    <li className={`p-4 rounded-2xl border border-gray-200 ${staff.isRetired ? 'bg-gray-50' : 'bg-white'}`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <h3 className="font-bold text-gray-800 text-lg">{staff.name}</h3>
        {staff.kana ? <span className="text-sm text-gray-600">{staff.kana}</span> : null}
      </div>
      <p className="text-sm text-gray-700 break-all">{staff.email}</p>
      <div className="flex flex-wrap gap-1 mt-2">
        {staff.role !== 'staff' ? <Badge tone="blue">{ROLE_LABELS[staff.role]}</Badge> : null}
        {staff.isRetired ? <Badge tone="gray">{`退職（${staff.retiredOn}）`}</Badge> : null}
        {!staff.isRetired && staff.retiredOn ? (
          <Badge tone="amber">{`${staff.retiredOn} 退職予定`}</Badge>
        ) : null}
        <Badge tone={staff.passwordStatus === 'set' ? 'green' : 'amber'}>
          {PASSWORD_STATUS_LABELS[staff.passwordStatus]}
        </Badge>
        {!staff.homeAddress ? <Badge tone="red">自宅住所なし</Badge> : null}
        {staff.homeAddress && !staff.hasHomeGeo ? <Badge tone="amber">自宅の位置が未確定</Badge> : null}
      </div>
      <div className="flex gap-3 mt-3">
        <button
          type="button"
          onClick={() => onEdit(staff)}
          aria-label={`${staff.name}さんを編集`}
          className="flex-1 min-h-11 px-3 py-2 text-sm font-bold text-gray-800 bg-gray-200 rounded-xl"
        >
          ✏️ 編集
        </button>
        {canSendGuide ? (
          <button
            type="button"
            onClick={() => onSendGuide(staff)}
            disabled={sendingGuide}
            aria-label={`${staff.name}さんにパスワード設定の案内メールを送る`}
            className="flex-1 min-h-11 px-3 py-2 text-sm font-bold text-blue-700 bg-blue-50 rounded-xl"
          >
            ✉️ パスワード設定の案内
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** 管理画面「スタッフ」(GAS版でスタッフ台帳シートを直接編集していた作業)。 */
export function StaffAdminPanel() {
  const { user } = useSession();
  const confirm = useConfirmModal();
  const list = useAdminStaffList();
  const { sendPasswordGuide } = useAdminStaffMutations();
  const [search, setSearch] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
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
    <section aria-labelledby="adminStaffHeading" className="space-y-4">
      <h2 id="adminStaffHeading" className="sr-only">
        スタッフ
      </h2>
      <div className="flex gap-3">
        <input
          type="search"
          aria-label="スタッフを探す(氏名・カナ・メール)"
          placeholder="氏名・カナ・メールで探す"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={INPUT_CLASS}
        />
        <button
          type="button"
          onClick={() => openForm(null)}
          className="shrink-0 min-h-12 px-4 bg-blue-600 text-white text-base font-bold rounded-xl"
        >
          ＋ 登録
        </button>
      </div>
      <label className="flex items-center gap-2 min-h-11 text-base text-gray-800">
        <input
          type="checkbox"
          checked={showRetired}
          onChange={(e) => setShowRetired(e.target.checked)}
          className="w-5 h-5"
        />
        退職者も表示する{retiredCount > 0 ? `（${retiredCount}人）` : ''}
      </label>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState message={userMessageOf(list.error)} />
      ) : shown.length === 0 ? (
        <EmptyState icon="👤" title="該当するスタッフはいません" />
      ) : (
        <ul className="space-y-3" aria-label="スタッフの一覧">
          {shown.map((s) => (
            <StaffCard
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
