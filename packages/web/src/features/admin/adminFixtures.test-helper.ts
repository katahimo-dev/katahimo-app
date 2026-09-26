import type { AdminStaffView } from '@katahimo/shared';

/** 管理画面のテスト用のスタッフ(一覧の1件)。 */
export function adminStaff(overrides: Partial<AdminStaffView> = {}): AdminStaffView {
  return {
    id: '00000000-0000-4000-8000-00000000b001',
    name: '佐藤 花子',
    kana: 'サトウ ハナコ',
    email: 'hanako@example.com',
    altEmail: null,
    phone: null,
    role: 'staff',
    retiredOn: null,
    isRetired: false,
    passwordStatus: 'set',
    homeAddress: '東京都世田谷区用賀4-1-1',
    hasHomeGeo: true,
    travelMode: null,
    gender: null,
    scheduleCalendarId: null,
    rowVersion: 3,
    ...overrides,
  };
}
