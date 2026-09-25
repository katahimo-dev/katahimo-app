import type { EncryptionPurpose } from '../../ports/crypto';

/**
 * 暗号化する値の用途(CryptoPort の AAD に含める `テーブル.列`)。書き込みと読み出しで同じ値を使うため
 * ここに1か所で定義する。AAD にはさらに行ID(主キー。自然キーの表はその値)を含める。
 * 変更履歴(entity_changes.before_enc)は元の列の暗号文を写さず、entityChangeBefore の用途と履歴の行IDで
 * 暗号化し直す。記録の変更履歴(care_record_revisions)だけは DB のトリガーが暗号文をそのまま写すため、
 * 元の記録の用途・記録のIDで復号する。
 */
export const ENCRYPTION_PURPOSES = {
  customerMemo: 'customers.memo',
  customerBenefitMemberId: 'customers.benefit_member_id',
  customerEvacuationSite: 'customers.evacuation_site',
  customerAddressGeo: 'customer_addresses.geo',
  customerContactName: 'customer_contacts.name',
  customerContactPhone: 'customer_contacts.phone',
  customerContactNotes: 'customer_contacts.notes',
  careRecipientAllergy: 'care_recipients.allergy',
  careRecipientNeeds: 'care_recipients.needs',
  customerPreferenceNotes: 'customer_preferences.notes',
  staffHomeGeo: 'staff.home_geo',
  attendanceRemarks: 'attendance_days.remarks',
  visitLabel: 'visits.label',
  workSegmentDescription: 'work_segments.description',
  careRecordBody: 'care_records.body',
  receiptStoreName: 'receipts.store_name',
  receiptHandoffText: 'receipt_uploads.handoff_text',
  tenantSecretValue: 'tenant_secrets.value',
  passwordResetMailCode: 'password_reset_codes.mail_code',
  entityChangeBefore: 'entity_changes.before',
} as const satisfies Record<string, EncryptionPurpose>;
