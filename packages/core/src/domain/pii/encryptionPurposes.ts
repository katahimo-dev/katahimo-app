import type { EncryptionPurpose } from '../../ports/crypto';

/**
 * 暗号化する値の用途(CryptoPort の AAD に含める `テーブル.列`)。書き込み側と読み出し側で同じ値を使う
 * ため、ここに1か所で定義する。attendance_day_changes.previous_row_data は attendance_days.row_data の
 * 暗号文をそのまま写すため、用途は attendance_days.row_data のまま(論理的に同じ値)。
 */
export const ENCRYPTION_PURPOSES = {
  customerEmergencyContact: 'customers.emergency_contact',
  customerEmergencyContactRelation: 'customers.emergency_contact_relation',
  customerEvacuationSite: 'customers.evacuation_site',
  customerMemo: 'customers.memo',
  customerBenefitMemberId: 'customers.benefit_member_id',
  customerLatLng: 'customers.lat_lng',
  familyMemberName: 'family_members.name',
  familyMemberDob: 'family_members.dob',
  familyMemberInfo: 'family_members.info',
  familyMemberAllergy: 'family_members.allergy',
  staffHomeLatLng: 'staff.home_lat_lng',
  attendanceRowData: 'attendance_days.row_data',
  dailyReportContent: 'daily_reports.content',
  accidentReportContent: 'accident_reports.content',
  receiptAmount: 'receipts.amount',
  receiptStoreName: 'receipts.store_name',
  receiptHandoffText: 'receipts.handoff_text',
  geminiApiKey: 'app_settings.gemini_api_key',
  gchatReportWebhookUrl: 'app_settings.gchat_report_webhook_url',
  gchatReceiptWebhookUrl: 'app_settings.gchat_receipt_webhook_url',
  passwordResetMailCode: 'password_reset_codes.mail_code',
} as const satisfies Record<string, EncryptionPurpose>;
