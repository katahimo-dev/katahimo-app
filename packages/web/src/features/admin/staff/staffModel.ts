import type {
  AdminStaffView,
  CreateStaffRequest,
  Gender,
  HomeGeocodeStatus,
  PasswordStatus,
  StaffRole,
  TravelModeCode,
  UpdateStaffRequest,
} from '@katahimo/shared';

export const ROLE_LABELS: Record<StaffRole, string> = {
  staff: 'スタッフ',
  coordinator: 'コーディネーター',
  admin: '管理者',
};

export const TRAVEL_MODE_LABELS: Record<TravelModeCode, string> = {
  car: '車',
  bicycle: '自転車',
  transit: '電車・バス',
  walk: '徒歩',
};

export const GENDER_LABELS: Record<Gender, string> = {
  female: '女性',
  male: '男性',
  other: 'その他',
  unknown: '回答しない',
};

export const PASSWORD_STATUS_LABELS: Record<PasswordStatus, string> = {
  set: 'パスワード設定済み',
  legacy: 'GAS版のパスワード',
  unset: 'パスワード未設定',
};

/** 自宅住所を保存したのに緯度経度を得られなかったときの案内(ok のときは出さない)。 */
export const HOME_GEOCODE_WARNINGS: Record<Exclude<HomeGeocodeStatus, 'ok'>, string> = {
  not_found: '自宅住所の場所が地図で見つかりませんでした。住所は保存し、ルートの計算のときに住所で探します。',
  failed: '自宅住所の場所を調べられませんでした。住所は保存し、ルートの計算のときに住所で探します。',
  unavailable: '地図を使わない設定のため、自宅住所は住所だけを保存しました。',
};

/** 氏名・カナ・メールの一部で探す(空白の有無は問わない)。退職者は showRetired のときだけ。 */
export function filterStaff(staff: AdminStaffView[], query: string, showRetired: boolean): AdminStaffView[] {
  const needle = query.replace(/\s+/g, '').toLowerCase();
  return staff.filter((s) => {
    if (s.isRetired && !showRetired) return false;
    if (!needle) return true;
    return [s.name, s.kana ?? '', s.email, s.altEmail ?? '']
      .map((v) => v.replace(/\s+/g, '').toLowerCase())
      .some((v) => v.includes(needle));
  });
}

/** 入力欄の値(すべて文字列。空欄は値なし)。 */
export interface StaffFormValues {
  name: string;
  kana: string;
  email: string;
  altEmail: string;
  phone: string;
  role: StaffRole;
  homeAddress: string;
  travelMode: TravelModeCode | '';
  gender: Gender | '';
  scheduleCalendarId: string;
  retiredOn: string;
  initialPassword: string;
}

export function emptyStaffForm(): StaffFormValues {
  return {
    name: '',
    kana: '',
    email: '',
    altEmail: '',
    phone: '',
    role: 'staff',
    homeAddress: '',
    travelMode: '',
    gender: '',
    scheduleCalendarId: '',
    retiredOn: '',
    initialPassword: '',
  };
}

export function staffFormOf(staff: AdminStaffView): StaffFormValues {
  return {
    name: staff.name,
    kana: staff.kana ?? '',
    email: staff.email,
    altEmail: staff.altEmail ?? '',
    phone: staff.phone ?? '',
    role: staff.role,
    homeAddress: staff.homeAddress ?? '',
    travelMode: staff.travelMode ?? '',
    gender: staff.gender ?? '',
    scheduleCalendarId: staff.scheduleCalendarId ?? '',
    retiredOn: staff.retiredOn ?? '',
    initialPassword: '',
  };
}

const orNull = (value: string) => value.trim() || null;

function profileFields(values: StaffFormValues) {
  return {
    name: values.name,
    kana: orNull(values.kana),
    email: values.email,
    altEmail: orNull(values.altEmail),
    phone: orNull(values.phone),
    role: values.role,
    homeAddress: orNull(values.homeAddress),
    travelMode: values.travelMode || null,
    gender: values.gender || null,
    scheduleCalendarId: orNull(values.scheduleCalendarId),
  };
}

export function toCreateRequest(values: StaffFormValues): CreateStaffRequest {
  return {
    ...profileFields(values),
    ...(values.initialPassword ? { initialPassword: values.initialPassword } : {}),
  };
}

/** 変えた項目だけを送る(他の管理者が同時に別の項目を変えても上書きしないように。版でも確かめる)。 */
export function toUpdateRequest(
  original: AdminStaffView,
  values: StaffFormValues,
): UpdateStaffRequest | null {
  const before = { ...profileFields(staffFormOf(original)), retiredOn: original.retiredOn };
  const after = { ...profileFields(values), retiredOn: values.retiredOn || null };
  const changed = Object.fromEntries(
    (Object.keys(after) as (keyof typeof after)[])
      .filter((key) => after[key] !== before[key])
      .map((key) => [key, after[key]]),
  );
  if (Object.keys(changed).length === 0) return null;
  return { ...changed, rowVersion: original.rowVersion };
}
