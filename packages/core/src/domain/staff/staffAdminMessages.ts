/** 管理画面のスタッフの登録・更新・取込で共通の断りの文言。 */

export const CALENDAR_NOT_ALLOWED_MESSAGE = 'このカレンダーは使えません。運用担当者に登録を依頼してください';

export const LAST_ADMIN_MESSAGE =
  '管理者が1人もいなくなるため、この操作はできません。先に別の管理者を決めてください';

export const CANNOT_DEMOTE_SELF_MESSAGE = '自分自身の管理者権限は解除できません';

export const CANNOT_RETIRE_SELF_MESSAGE = '自分自身に退職日は設定できません';

export const STAFF_EMAIL_CONFLICT_MESSAGES = {
  email: 'このメールアドレスは他のスタッフが使用しています',
  altEmail: 'このサブメールは他のスタッフが使用しているか、メールアドレスと同じです',
} as const;
