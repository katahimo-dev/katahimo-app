export interface StaffView {
  staffId?: string;
  id?: string;
  tenantId: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface CustomerView {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
}

export interface FamilyMemberView {
  id: string;
  name: string;
  dob: string | null;
  info: string | null;
}

export interface CustomerDetailView {
  id: string;
  externalSource: string | null;
  externalId: string | null;
  name: string;
  familyNameKana: string | null;
  givenNameKana: string | null;
  email: string | null;
  phone: string | null;
  addressDetail: string | null;
  city: string | null;
  parkingArea: string | null;
  parkingDetail: string | null;
  emergencyContact: string | null;
  emergencyContactRelation: string | null;
  evacuationSite: string | null;
  memo: string | null;
  benefitMemberId: string | null;
  address2: string | null;
  address2StartDate: string | null;
  address2EndDate: string | null;
  latLng: string | null;
  memberType: string | null;
  memberStatus: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  gender: string | null;
  ageBracket: string | null;
  registeredAt: string | null;
  externalLastUpdatedAt: string | null;
  deactivatedAt: string | null;
  familyMembers: FamilyMemberView[];
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body.message === 'string' ? body.message : `APIエラー: ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function login(tenantSlug: string, email: string, password: string): Promise<StaffView> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ tenantSlug, email, password }),
  });
  const body = await parseJsonOrThrow<{ staff: StaffView }>(res);
  return body.staff;
}

export async function fetchMe(): Promise<StaffView | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  const body = await parseJsonOrThrow<{ staff: StaffView }>(res);
  return body.staff;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || 'パスワードの変更に失敗しました');
}

export interface ActiveStaffView {
  id: string;
  name: string;
}

/** 管理者向け「対象スタッフ」一覧(退職者を除く)。管理者以外は空配列が返る。 */
export async function fetchActiveStaffForAdmin(): Promise<ActiveStaffView[]> {
  const res = await fetch('/api/staff', { credentials: 'include' });
  const body = await parseJsonOrThrow<{ staff: ActiveStaffView[] }>(res);
  return body.staff;
}

// ── 管理者設定(GAS版の設定モーダル「管理者設定」に対応) ──

export interface AdminSettingsView {
  geminiApiKey: string;
  geminiReportModel: string;
  geminiOcrModel: string;
  gchatReportWebhookUrl: string;
  gchatReceiptWebhookUrl: string;
}

export async function fetchAdminSettings(): Promise<AdminSettingsView> {
  const res = await fetch('/api/settings/admin', { credentials: 'include' });
  const body = await parseJsonOrThrow<{ settings: AdminSettingsView }>(res);
  return body.settings;
}

export interface SaveSettingsResult {
  ok: boolean;
  message: string;
}

async function postSettings(path: string, payload: unknown): Promise<SaveSettingsResult> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<SaveSettingsResult>(res);
}

export function saveGeminiApiKey(apiKey: string): Promise<SaveSettingsResult> {
  return postSettings('/api/settings/admin/gemini-key', { apiKey });
}

export function saveGeminiModelSettings(reportModel: string, ocrModel: string): Promise<SaveSettingsResult> {
  return postSettings('/api/settings/admin/gemini-models', { reportModel, ocrModel });
}

export function saveGoogleChatWebhookSettings(
  reportWebhookUrl: string,
  receiptWebhookUrl: string,
): Promise<SaveSettingsResult> {
  return postSettings('/api/settings/admin/gchat-webhooks', { reportWebhookUrl, receiptWebhookUrl });
}

export interface GeminiModelInfo {
  name: string;
  displayName: string;
}

export async function listAvailableGeminiModels(apiKey: string): Promise<GeminiModelInfo[]> {
  const res = await fetch('/api/settings/admin/gemini-models/available', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ apiKey }),
  });
  const body = await parseJsonOrThrow<{ success: boolean; models?: GeminiModelInfo[]; message?: string }>(
    res,
  );
  if (!body.success) throw new Error(body.message || 'モデル一覧の取得に失敗しました');
  return body.models ?? [];
}

export async function searchCustomersByFamilyName(familyName: string): Promise<CustomerView[]> {
  const res = await fetch(`/api/customers?familyName=${encodeURIComponent(familyName)}`, {
    credentials: 'include',
  });
  const body = await parseJsonOrThrow<{ customers: CustomerView[] }>(res);
  return body.customers;
}

export interface CustomerListResult {
  customers: CustomerView[];
  cities: string[];
}

/**
 * 有効な顧客を全件取得する。GAS版のgetData()相当(訪問先一覧の既定表示・名前の部分一致検索・
 * 地区絞り込みは全てこれで取得した一覧をブラウザ側で絞り込む)。
 */
export async function fetchAllCustomers(): Promise<CustomerListResult> {
  const res = await fetch('/api/customers', { credentials: 'include' });
  return parseJsonOrThrow<CustomerListResult>(res);
}

export async function fetchCustomerDetail(customerId: string): Promise<CustomerDetailView> {
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ customer: CustomerDetailView }>(res);
  return body.customer;
}

/** 出勤簿テンプレートの入力列(PastSchedule.jsのPAST_SCHEDULE_INPUT_COLUMNSと同じ列記号)。 */
export interface AttendanceRowData {
  C?: string;
  D?: string;
  E?: string;
  H?: string;
  I?: string;
  L?: string;
  M?: string;
  N?: string;
  Q?: string;
  R?: string;
  U?: string;
  V?: string;
  W?: string;
  X?: string;
  Y?: string;
  Z?: string;
  AA?: string;
  AB?: string;
  AC?: string;
  AG?: string;
  AH?: string;
  AI?: string;
  AJ?: string;
  AN?: string;
  AO?: string;
}

export interface AttendanceDayDerived {
  leg1MoveStart: string;
  leg1MoveEnd: string;
  leg1WeatherAdjustedMoveMin: number | '';
  leg1WaitMin: number | '';
  leg2MoveStart: string;
  leg2MoveEnd: string;
  leg2WeatherAdjustedMoveMin: number | '';
  leg2WaitMin: number | '';
  laborMinutes: number;
  overtimeMinutes: number;
  totalMoveMin: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCount: number;
}

export interface AttendanceDayView {
  businessDate: string;
  rowData: AttendanceRowData;
  derived: AttendanceDayDerived;
}

export interface AttendanceMonthlyTotals {
  laborMinutes: number;
  overtimeMinutes: number;
  totalMoveMin: number;
  leg1DistanceKmTotal: number;
  leg2DistanceKmTotal: number;
  attendanceDistanceKmTotal: number;
  leavingDistanceKmTotal: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCountTotal: number;
  shoppingErrandTotal: number;
}

export interface AttendanceMonthView {
  yearMonth: string;
  days: AttendanceDayView[];
  totals: AttendanceMonthlyTotals;
}

/** staffIdは管理者が「対象スタッフ」を選んでいる場合のみ渡す(非管理者は常に自分自身なので不要)。 */
export async function fetchAttendanceDay(date: string, staffId?: string): Promise<AttendanceDayView> {
  const params = new URLSearchParams({ date });
  if (staffId) params.set('staffId', staffId);
  const res = await fetch(`/api/attendance/day?${params.toString()}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ attendance: AttendanceDayView }>(res);
  return body.attendance;
}

export async function saveAttendanceDay(
  date: string,
  rowData: AttendanceRowData,
  staffId?: string,
): Promise<AttendanceDayView> {
  const res = await fetch('/api/attendance/day', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ date, rowData, staffId }),
  });
  const body = await parseJsonOrThrow<{ attendance: AttendanceDayView }>(res);
  return body.attendance;
}

export async function fetchAttendanceMonth(
  yearMonth: string,
  staffId?: string,
): Promise<AttendanceMonthView> {
  const params = new URLSearchParams({ month: yearMonth });
  if (staffId) params.set('staffId', staffId);
  const res = await fetch(`/api/attendance/month?${params.toString()}`, {
    credentials: 'include',
  });
  const body = await parseJsonOrThrow<{ month: AttendanceMonthView }>(res);
  return body.month;
}

export type ScheduleEventType = 'CUSTOMER APPOINTMENT' | 'OFFICE WORK';

export interface ScheduleEvent {
  date: string;
  slotKey: 'slot1' | 'slot2' | 'slot3' | 'office1' | 'office2';
  title: string;
  eventType: ScheduleEventType;
  start: string;
  end: string;
}

export async function fetchAttendanceWeekEvents(
  start: string,
  end: string,
  staffId?: string,
): Promise<ScheduleEvent[]> {
  const params = new URLSearchParams({ start, end });
  if (staffId) params.set('staffId', staffId);
  const res = await fetch(`/api/attendance/week?${params.toString()}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ events: ScheduleEvent[] }>(res);
  return body.events;
}

// ── 日報/事故報告/活動記録/領収書登録(gas-childcare-visit-appの訪問先カード内モーダルに対応) ──

export interface DailyReportDraft {
  warnings: string[];
  internal: string;
  customer: string;
}

export interface AccidentReportDraft {
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
}

export interface AccidentReportDraftError {
  error: string;
}

export async function generateDailyReportDraft(
  text: string,
  start?: string,
  end?: string,
): Promise<DailyReportDraft> {
  const res = await fetch('/api/reports/daily/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text, start, end }),
  });
  const body = await parseJsonOrThrow<{ draft: DailyReportDraft }>(res);
  return body.draft;
}

export async function generateAccidentReportDraft(
  text: string,
  start?: string,
  end?: string,
): Promise<AccidentReportDraft | AccidentReportDraftError> {
  const res = await fetch('/api/reports/accident/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text, start, end }),
  });
  const body = await parseJsonOrThrow<{ draft: AccidentReportDraft | AccidentReportDraftError }>(res);
  return body.draft;
}

export interface SaveDailyReportInput {
  reportId?: string;
  customerId: string;
  reportDate?: string;
  startTime: string;
  endTime: string;
  inputText: string;
  internalText: string;
  customerText: string;
  riskRating: number | null;
  esRating: number | null;
}

export interface DailyReportView {
  id: string;
  occurredAt: string;
  staffId: string;
  customerId: string;
  riskRating: number | null;
  esRating: number | null;
}

/** 「訪問完了」通知のみを送信する(DB書き込みなし)。GAS版sendVisitComplete相当。 */
export async function sendVisitCompleteNotification(
  customerId: string,
  visitDate: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  const res = await fetch('/api/reports/visit-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ customerId, visitDate, startTime, endTime }),
  });
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || '訪問完了通知の送信に失敗しました');
}

export async function saveDailyReport(input: SaveDailyReportInput): Promise<DailyReportView> {
  const res = await fetch('/api/reports/daily', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await parseJsonOrThrow<{ success: boolean; report: DailyReportView; message?: string }>(res);
  if (!body.success) throw new Error(body.message || '日報の保存に失敗しました');
  return body.report;
}

export interface SaveAccidentReportInput {
  reportId?: string;
  customerId: string;
  reportType?: string;
  targetName: string;
  targetDob: string;
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
  inputText: string;
}

export interface AccidentReportView {
  id: string;
  occurredAt: string;
  staffId: string;
  customerId: string;
  reportType: string;
}

export async function saveAccidentReport(input: SaveAccidentReportInput): Promise<AccidentReportView> {
  const res = await fetch('/api/reports/accident', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await parseJsonOrThrow<{ success: boolean; report: AccidentReportView; message?: string }>(
    res,
  );
  if (!body.success) throw new Error(body.message || '事故報告の保存に失敗しました');
  return body.report;
}

export interface HistoryItem {
  type: 'daily' | 'accident';
  id: string;
  occurredAtIso: string;
  timestamp: string;
  staff: string;
  original: string;
  internal: string;
  customer: string;
  risk?: number | null;
  es?: number | null;
  isAccident?: boolean;
  subtype?: string;
}

export async function fetchCustomerHistory(customerId: string, before?: string): Promise<HistoryItem[]> {
  const params = new URLSearchParams({ customerId });
  if (before) params.set('before', before);
  const res = await fetch(`/api/reports/history?${params.toString()}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ items: HistoryItem[] }>(res);
  return body.items;
}

export interface ReceiptImageUpload {
  data: string;
  amount?: string | number | null;
  storeName?: string | null;
  receiptDate?: string | null;
}

export interface UploadReceiptsInput {
  customerId: string | null;
  images: ReceiptImageUpload[];
  receiptTimestamp?: string;
  handoffText?: string;
}

export interface ReceiptDuplicateInfo {
  index: number;
  timestamp: string;
  amount: string;
  storeName: string;
}

export interface UploadReceiptsResult {
  success: boolean;
  message: string;
  uploadedCount: number;
  duplicateCount: number;
  duplicates: ReceiptDuplicateInfo[];
}

export async function uploadReceipts(input: UploadReceiptsInput): Promise<UploadReceiptsResult> {
  const res = await fetch('/api/receipts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<UploadReceiptsResult>(res);
}

export interface ReceiptOcrResult {
  amount: string | number;
  storeName: string;
  receiptDate: string;
  /** OCR呼び出し自体が失敗した場合のエラーメッセージ(成功時はundefined)。 */
  error?: string;
}

export async function extractReceiptOcr(image: string): Promise<ReceiptOcrResult> {
  const res = await fetch('/api/receipts/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ image }),
  });
  const body = await parseJsonOrThrow<{ result: ReceiptOcrResult }>(res);
  return body.result;
}

// ── 予定タブ(GAS版Schedule.js/RouteSearch.jsのブリッジ経由) ──

export interface DailyScheduleAppointment {
  title: string;
  eventType: string;
  start: string;
  end: string;
  address: string;
}

export interface DailyScheduleResult {
  success: boolean;
  date?: string;
  staffName?: string;
  appointments?: DailyScheduleAppointment[];
  message?: string;
}

/** ルート・移動時間を含まない軽量版。GAS版Schedule.js getScheduleForDate相当。 */
export async function fetchDailySchedule(date: string, staffId?: string): Promise<DailyScheduleResult> {
  const params = new URLSearchParams({ date });
  if (staffId) params.set('staffId', staffId);
  const res = await fetch(`/api/schedule?${params.toString()}`, { credentials: 'include' });
  return parseJsonOrThrow<DailyScheduleResult>(res);
}

export interface DailyScheduleAppointmentWithRoute {
  eventType: string;
  customerName: string;
  startTime: string;
  endTime: string;
  reservaUrl: string;
  moveUrl: string;
  moveMin: number | string;
  moveKm: number | string;
  attendanceUrl: string;
  attendanceMin: number | string;
  attendanceKm: number | string;
  leavingUrl: string;
  leavingMin: number | string;
  leavingKm: number | string;
  customerId: string;
  address: string;
}

export interface DailyScheduleWithRouteResult {
  success: boolean;
  date?: string;
  staffName?: string;
  appointments?: DailyScheduleAppointmentWithRoute[];
  message?: string;
}

/** ルート・移動時間つき。GAS版Schedule.js getRouteForStaffOnDate相当(Maps連携を伴うため時間がかかる)。 */
export async function fetchDailyScheduleWithRoute(
  date: string,
  staffId?: string,
  forceRefresh?: boolean,
): Promise<DailyScheduleWithRouteResult> {
  const params = new URLSearchParams({ date });
  if (staffId) params.set('staffId', staffId);
  if (forceRefresh) params.set('forceRefresh', '1');
  const res = await fetch(`/api/schedule/route?${params.toString()}`, { credentials: 'include' });
  return parseJsonOrThrow<DailyScheduleWithRouteResult>(res);
}
