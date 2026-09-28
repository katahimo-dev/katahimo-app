import {
  type AdminStaffResponse,
  type AdminStaffView,
  GENDERS,
  STAFF_ROLES,
  TRAVEL_MODES,
} from '@katahimo/shared';
import { useEffect, useState } from 'react';
import { ApiRequestError, userMessageOf } from '../../../api/client';
import { todayJst } from '../../../lib/date';
import { useConfirmModal } from '../../../ui/confirm';
import { Modal, ModalFooter, ModalHeader } from '../../../ui/modal';
import { showErrorToast, showToast } from '../../../ui/toast';
import { FormField, fieldA11y, INPUT_CLASS } from '../components/FormField';
import {
  emptyStaffForm,
  GENDER_LABELS,
  HOME_GEOCODE_WARNINGS,
  ROLE_LABELS,
  type StaffFormValues,
  staffFormOf,
  TRAVEL_MODE_LABELS,
  toCreateRequest,
  toUpdateRequest,
} from './staffModel';
import { useAdminStaffMutations } from './useAdminStaff';

interface StaffFormModalProps {
  open: boolean;
  /** 編集するスタッフ(null は新規登録)。 */
  staff: AdminStaffView | null;
  /** ログイン中の管理者自身か(役割・退職日・削除を変えられない)。 */
  isSelf: boolean;
  onClose: () => void;
}

type FieldErrors = Partial<Record<keyof StaffFormValues, string>>;

/** 保存の結果のお知らせ(自宅住所の場所を得られなかったときは閉じるまで残す)。 */
function notifySaved(result: AdminStaffResponse, verb: string) {
  const warning =
    result.homeGeocode && result.homeGeocode !== 'ok' ? HOME_GEOCODE_WARNINGS[result.homeGeocode] : null;
  if (warning) showToast(`${verb}しました。${warning}`, true);
  else showToast(`${verb}しました`);
}

/** スタッフの登録・編集(退職日の設定・削除を含む)。入力の誤りはサーバーの文言を項目の下に出す。 */
export function StaffFormModal({ open, staff, isSelf, onClose }: StaffFormModalProps) {
  const confirm = useConfirmModal();
  const mutations = useAdminStaffMutations();
  const [values, setValues] = useState<StaffFormValues>(emptyStaffForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    setValues(staff ? staffFormOf(staff) : emptyStaffForm());
    setErrors({});
    setFormError('');
  }, [open, staff]);

  const saving = mutations.create.isPending || mutations.update.isPending || mutations.remove.isPending;
  const dirty = staff
    ? toUpdateRequest(staff, values) !== null
    : JSON.stringify(values) !== JSON.stringify(emptyStaffForm());

  /** ×・Escape・キャンセル。保存中は閉じず、書きかけがあれば確かめる。 */
  const requestClose = async () => {
    if (saving) return;
    if (dirty) {
      const ok = await confirm({
        title: '保存していない変更があります。閉じますか？',
        confirmLabel: '閉じる',
      });
      if (!ok) return;
    }
    onClose();
  };
  const set = <K extends keyof StaffFormValues>(key: K, value: StaffFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const showFailure = (error: unknown) => {
    if (error instanceof ApiRequestError) {
      setErrors((error.fields ?? {}) as FieldErrors);
      setFormError(error.message);
    } else {
      setErrors({});
      setFormError(userMessageOf(error));
    }
  };

  const save = async () => {
    setErrors({});
    setFormError('');
    try {
      if (!staff) {
        notifySaved(await mutations.create.mutateAsync(toCreateRequest(values)), '登録');
      } else {
        const body = toUpdateRequest(staff, values);
        if (!body) {
          onClose();
          return;
        }
        notifySaved(await mutations.update.mutateAsync({ staffId: staff.id, body }), '保存');
      }
      onClose();
    } catch (error) {
      showFailure(error);
    }
  };

  const remove = async () => {
    if (!staff) return;
    const ok = await confirm({
      title: `${staff.name}さんを削除しますか？（元に戻せません）`,
      confirmLabel: '削除する',
    });
    if (!ok) return;
    try {
      await mutations.remove.mutateAsync(staff.id);
      showToast('削除しました');
      onClose();
    } catch (error) {
      showErrorToast(error);
    }
  };

  const input = (key: keyof StaffFormValues, props: { type?: string; inputMode?: 'email' | 'tel' } = {}) => {
    const id = `adminStaff-${key}`;
    return (
      <input
        id={id}
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        value={values[key]}
        onChange={(e) => set(key, e.target.value as never)}
        className={INPUT_CLASS}
        {...fieldA11y(id, errors[key])}
      />
    );
  };

  return (
    <Modal
      open={open}
      labelledBy="adminStaffFormTitle"
      onClose={() => void requestClose()}
      className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-3 transition-opacity duration-300"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="bg-white w-full max-w-md rounded-xl border border-gray-200 flex flex-col max-h-[90vh]"
      >
        <ModalHeader
          title={staff ? 'スタッフの編集' : 'スタッフの登録'}
          titleId="adminStaffFormTitle"
          onClose={() => void requestClose()}
        />
        <div className="p-3 space-y-4 overflow-y-auto">
          <FormField
            id="adminStaff-name"
            label="氏名"
            required
            error={errors.name}
            hint="姓と名の間に空白を入れます"
          >
            {input('name')}
          </FormField>
          <FormField id="adminStaff-kana" label="カナ" error={errors.kana} hint="例）サトウ ハナコ">
            {input('kana')}
          </FormField>
          <FormField id="adminStaff-email" label="メールアドレス(ログインID)" required error={errors.email}>
            {input('email', { type: 'email', inputMode: 'email' })}
          </FormField>
          <FormField
            id="adminStaff-altEmail"
            label="サブメール"
            error={errors.altEmail}
            hint="こちらでもログインできます"
          >
            {input('altEmail', { type: 'email', inputMode: 'email' })}
          </FormField>
          <FormField id="adminStaff-phone" label="電話" error={errors.phone}>
            {input('phone', { type: 'tel', inputMode: 'tel' })}
          </FormField>
          <FormField
            id="adminStaff-role"
            label="役割"
            error={errors.role}
            hint={isSelf ? '自分自身の役割は変えられません' : undefined}
          >
            <select
              id="adminStaff-role"
              value={values.role}
              disabled={isSelf}
              onChange={(e) => set('role', e.target.value as StaffFormValues['role'])}
              className={INPUT_CLASS}
            >
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="adminStaff-homeAddress"
            label="自宅住所"
            error={errors.homeAddress}
            hint="出勤・退勤の経路の起点です"
          >
            {input('homeAddress')}
          </FormField>
          <FormField id="adminStaff-travelMode" label="移動手段" error={errors.travelMode}>
            <select
              id="adminStaff-travelMode"
              value={values.travelMode}
              onChange={(e) => set('travelMode', e.target.value as StaffFormValues['travelMode'])}
              className={INPUT_CLASS}
            >
              <option value="">未設定(車)</option>
              {TRAVEL_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {TRAVEL_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="adminStaff-gender" label="性別" error={errors.gender}>
            <select
              id="adminStaff-gender"
              value={values.gender}
              onChange={(e) => set('gender', e.target.value as StaffFormValues['gender'])}
              className={INPUT_CLASS}
            >
              <option value="">未設定</option>
              {GENDERS.map((gender) => (
                <option key={gender} value={gender}>
                  {GENDER_LABELS[gender]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="adminStaff-scheduleCalendarId"
            label="予定を読むGoogleカレンダーのID"
            error={errors.scheduleCalendarId}
            hint="例）staff@example.com"
          >
            {input('scheduleCalendarId', { type: 'email', inputMode: 'email' })}
          </FormField>
          {staff ? (
            <FormField
              id="adminStaff-retiredOn"
              label="退職日"
              error={errors.retiredOn}
              hint={isSelf ? '自分自身には設定できません' : 'この日からログインできなくなります'}
            >
              <div className="flex gap-2">
                <input
                  id="adminStaff-retiredOn"
                  type="date"
                  value={values.retiredOn}
                  disabled={isSelf}
                  onChange={(e) => set('retiredOn', e.target.value)}
                  className={INPUT_CLASS}
                  {...fieldA11y('adminStaff-retiredOn', errors.retiredOn)}
                />
                {!isSelf ? (
                  <button
                    type="button"
                    onClick={() => set('retiredOn', values.retiredOn ? '' : todayJst())}
                    className="shrink-0 min-h-9 px-3 text-sm font-bold text-gray-800 bg-white rounded-lg border border-gray-300"
                  >
                    {values.retiredOn ? '取り消す' : '今日で退職'}
                  </button>
                ) : null}
              </div>
            </FormField>
          ) : (
            <FormField
              id="adminStaff-initialPassword"
              label="初期パスワード"
              error={errors.initialPassword}
              hint="空のままにすると、本人が「パスワード設定の案内」のメールから設定します"
            >
              {input('initialPassword', { type: 'password' })}
            </FormField>
          )}
          {staff && !isSelf ? (
            <div className="border-t pt-4">
              <button
                type="button"
                onClick={() => void remove()}
                disabled={saving}
                className="w-full min-h-9 py-2 text-sm font-bold text-red-600 bg-red-50 rounded-lg"
              >
                🗑 このスタッフを削除する
              </button>
              <p className="text-sm text-gray-600 mt-1">
                間違えて登録したときだけ使います。出勤簿などの記録がある方は退職日を設定してください。
              </p>
            </div>
          ) : null}
        </div>
        {formError ? (
          <p role="alert" className="px-4 py-1.5 border-t text-sm text-red-600 bg-red-50">
            {formError}
          </p>
        ) : null}
        <ModalFooter className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => void requestClose()}
            disabled={saving}
            className="min-h-9 px-4 py-1.5 bg-white text-gray-800 text-sm font-bold rounded-lg border border-gray-300"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-9 px-4 py-1.5 bg-blue-600 text-white text-sm font-bold rounded-lg"
          >
            {saving ? '保存中...' : staff ? '保存する' : '登録する'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
