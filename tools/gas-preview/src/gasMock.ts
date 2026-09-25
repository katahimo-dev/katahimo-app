import { AI_PROMPT_KEYS, ASSESSMENT_DEFINITIONS, findAiPromptDefinition } from '@katahimo/shared';
import { addDays, daysInMonth } from './dates';
import {
  ADMIN_SETTINGS,
  AVAILABLE_MODELS,
  attendanceRow,
  CUSTOMERS,
  calendarSyncChanges,
  customerReports,
  DATA_VERSION,
  MOCK_PASSWORD,
  monthReceipts,
  routeAppointments,
  STAFF,
  staffByToken,
  WEATHER_OPTIONS,
} from './fixtures';
import { loadGasPureFunctions } from './gasRuntime';

/**
 * GAS版 index.html が google.script.run で呼ぶサーバー関数のモック。
 * 戻り値の形はGAS版のサーバー側(Main.js / Auth.js / Schedule.js / PastSchedule.js /
 * GeminiReport.js / GoogleChat.js)の return と同じにしている。
 *
 * - 例外を投げる = GAS版の withFailureHandler に渡る失敗。
 * - `today` はブラウザ側の日付(撮影時は Playwright で固定)。予定・出勤簿の日付の基準にする。
 * - 足りない関数を呼ばれたらエラーにして、ハーネスのログに出す(ここに追加すること)。
 */
export type GasHandler = (args: unknown[], ctx: { today: string }) => unknown;

const prompt = (key: (typeof AI_PROMPT_KEYS)[keyof typeof AI_PROMPT_KEYS]) =>
  findAiPromptDefinition(key)?.defaultBody ?? '';

function requireSession(token: unknown) {
  const staff = staffByToken(token);
  if (!staff) throw new Error('ログインセッションが無効です。再度ログインしてください。');
  return staff;
}

/** 管理者が staffName を指定した場合だけその人、それ以外は本人(GAS版 resolve…TargetStaffName_)。 */
function targetStaffName(token: unknown, requested: unknown): string {
  const self = requireSession(token);
  return self.isAdmin && typeof requested === 'string' && requested ? requested : self.name;
}

function customerDetails(c: (typeof CUSTOMERS)[number]) {
  const [sei = '', mei = ''] = c.name.split(' ');
  const [seiKana = '', meiKana = ''] = c.kana.split(' ');
  return [
    { key: '姓', value: sei },
    { key: '名', value: mei },
    { key: 'セイ', value: seiKana },
    { key: 'メイ', value: meiKana },
    { key: '住所', value: c.address },
    { key: '電話番号', value: c.phone },
    { key: 'メールアドレス', value: c.email },
    { key: '駐車場', value: c.parking },
    { key: '緊急連絡先', value: c.emergencyContact },
    { key: '備考', value: c.memo },
  ];
}

function yearMonthOf(date: string) {
  return date.slice(0, 7);
}

function editableRange(today: string) {
  const ym = yearMonthOf(today);
  return { from: `${ym}-01`, to: `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}` };
}

export const gasHandlers: Record<string, GasHandler> = {
  // ── 認証(Auth.js) ──
  verifyLogin: ([email, password]) => {
    const staff = STAFF.find((s) => s.email === String(email).trim());
    if (!staff || password !== MOCK_PASSWORD) {
      return { success: false, message: 'メールアドレスまたはパスワードが違います' };
    }
    return { success: true, name: staff.name, token: staff.token, isAdmin: staff.isAdmin };
  },
  checkSession: ([token]) => {
    const staff = staffByToken(token);
    return staff
      ? { valid: true, name: staff.name, isAdmin: staff.isAdmin, userId: staff.email }
      : { valid: false };
  },
  requestPasswordReset: ([id]) =>
    STAFF.some((s) => s.email === id)
      ? { success: true }
      : { success: false, message: 'ユーザーIDが見つからないか、メールアドレスが登録されていません' },
  resetPasswordWithCode: ([, code]) =>
    code === '123456' ? { success: true } : { success: false, message: '無効な認証コードです' },
  changePassword: ([token, current]) => {
    requireSession(token);
    return current === MOCK_PASSWORD
      ? { success: true, message: 'パスワードを変更しました' }
      : { success: false, message: '現在のパスワードが正しくありません' };
  },

  // ── 顧客・データ版数(Main.js / CsvImport.js) ──
  checkAndImportLatestCsv: () => 'No new CSV',
  checkDataVersion: () => DATA_VERSION,
  getUiConfig: () => ({
    dailyPlaceholder: prompt(AI_PROMPT_KEYS.DAILY_MEMO_PLACEHOLDER),
    accidentPlaceholder: prompt(AI_PROMPT_KEYS.ACCIDENT_MEMO_PLACEHOLDER),
    accidentHint: prompt(AI_PROMPT_KEYS.ACCIDENT_WRITING_HINT),
    hiyariPlaceholder: prompt(AI_PROMPT_KEYS.HIYARI_WRITING_HINT),
    assessments: ASSESSMENT_DEFINITIONS,
  }),
  getData: ([token]) => {
    requireSession(token);
    const customers = CUSTOMERS.map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address,
      city: c.city,
      lat: c.lat,
      lng: c.lng,
      family: c.family,
      details: customerDetails(c),
    }));
    const cities = [...new Set(customers.map((c) => c.city))].sort();
    return { cities, customers, version: DATA_VERSION };
  },
  getCustomerReports: ([token, customerId, startAfterTime], { today }) => {
    requireSession(token);
    const all = customerReports(String(customerId), today);
    const filtered = startAfterTime
      ? all.filter((r) => new Date(r.timestamp).getTime() < new Date(String(startAfterTime)).getTime())
      : all;
    return filtered.slice(0, 5);
  },

  // ── 予定(Schedule.js) ──
  getRouteForStaffOnDate: ([token, dateStr, requested], { today }) => {
    targetStaffName(token, requested);
    const offset = dateStr === today ? 0 : dateStr === addDays(today, 1) ? 1 : -1;
    return { success: true, appointments: routeAppointments(offset) };
  },
  getScheduleForDate: ([token, dateStr, requested], { today }) => {
    targetStaffName(token, requested);
    const offset = dateStr === today ? 0 : dateStr === addDays(today, 1) ? 1 : -1;
    return {
      success: true,
      appointments: routeAppointments(offset).map((a) => ({
        start: a.startTime,
        end: a.endTime,
        title: a.customerName,
        eventType: a.eventType,
        address: a.address,
      })),
    };
  },
  getActiveStaffNamesForAdmin: ([token]) => {
    const self = requireSession(token);
    return self.isAdmin ? STAFF.map((s) => s.name).sort() : [];
  },

  // ── 出勤簿(PastSchedule.js) ──
  getWeeklyScheduleForStaff: ([token, start, end, requested], { today }) => {
    const staffName = targetStaffName(token, requested);
    const gas = loadGasPureFunctions();
    const events: unknown[] = [];
    for (let d = String(start); d <= String(end); d = addDays(d, 1)) {
      events.push(...gas.buildScheduleEventsFromRowData_(d, attendanceRow(d, today)));
    }
    return { success: true, staffName, isAdmin: requireSession(token).isAdmin, events };
  },
  getPastScheduleForDate: ([token, dateString, requested], { today }) => {
    const staffName = targetStaffName(token, requested);
    const date = String(dateString);
    const range = editableRange(today);
    return {
      success: true,
      dateString: date,
      staffName,
      isAdmin: requireSession(token).isAdmin,
      sheetName: `${Number(date.slice(5, 7))}月`,
      rowNumber: 3 + Number(date.slice(8, 10)),
      rowData: attendanceRow(date, today),
      optionsI: WEATHER_OPTIONS,
      optionsR: WEATHER_OPTIONS,
      editable: date >= range.from && date <= range.to,
      editableFrom: range.from,
      editableTo: range.to,
    };
  },
  getAttendanceMonth: ([token, yearMonth, requested], { today }) => {
    const staffName = targetStaffName(token, requested);
    const ym = String(yearMonth);
    const gas = loadGasPureFunctions();
    const days = Array.from({ length: daysInMonth(ym) }, (_, i) => {
      const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
      const rowData = attendanceRow(date, today);
      return { date, rowData, derived: gas.computeDayDerived(rowData) };
    });
    return {
      success: true,
      staffName,
      isAdmin: requireSession(token).isAdmin,
      yearMonth: ym,
      days,
      monthlyTotals: gas.computeMonthlyTotals(days),
      receipts: monthReceipts(ym, today),
    };
  },
  updatePastSchedule: ([token]) => {
    requireSession(token);
    return { success: true, message: '修正しました。' };
  },
  previewCalendarSyncForStaffOnDate: ([token, dateString, requested], { today }) => {
    const staffName = targetStaffName(token, requested);
    const changes = calendarSyncChanges(String(dateString), today);
    return {
      success: true,
      staffName,
      dateString,
      appointmentCount: 4,
      hasChanges: changes.length > 0,
      changes,
    };
  },
  applyCalendarSyncForStaffOnDate: ([token, dateString, requested], { today }) => {
    const staffName = targetStaffName(token, requested);
    return {
      success: true,
      staffName,
      dateString,
      appointmentCount: 4,
      changedCount: calendarSyncChanges(String(dateString), today).length,
    };
  },
  syncPastScheduleFromCalendar: ([token, dateString, requested]) => {
    const staffName = targetStaffName(token, requested);
    return { success: true, staffName, dateString, appointmentCount: 3, message: '取り込みました' };
  },

  // ── 日報・事故報告・領収書(Main.js / GeminiReport.js) ──
  generateReportWithWarnings: () => ({
    warnings: [],
    internal:
      '【サポート内容】\n公園で外遊び、昼食の補助。\n\n【お客様の様子】\nお母様は少しお疲れの様子。\n\n【振り返り】\n次回は室内遊びも用意する。',
    customer: '本日もありがとうございました。公園でたくさん遊びました。',
  }),
  generateAccidentReport: () => ({
    occurrenceTime: '10:05',
    location: 'リビング',
    accidentContent: '転倒しそうになった',
    situation: 'ソファから降りようとしてバランスを崩した。',
    immediateResponse: 'すぐに支えたため、けがはなし。',
    parentCorrespondence: 'お迎え時にお母様へ報告した。',
    diagnosisTreatment: 'なし',
    prevention: 'ソファの前にマットを敷く。',
  }),
  saveReport: ([token]) => {
    requireSession(token);
    return { success: true, message: '保存しました', rowIndex: 120 };
  },
  saveAccidentReport: ([token]) => {
    requireSession(token);
    return { success: true, rowIndex: 30 };
  },
  sendVisitCompleteNotification: ([token]) => {
    requireSession(token);
    return { success: true };
  },
  extractAmountFromImage: () => ({
    amount: 1280,
    storeName: 'スーパーみどり',
    receiptDate: '2026/09/25 11:02',
  }),
  uploadReceiptsOnly: ([token]) => {
    requireSession(token);
    return { success: true, message: '領収書を送りました', duplicates: [] };
  },

  // ── 管理者設定(GeminiReport.js / GoogleChat.js) ──
  getGeminiApiKeyForAdmin: ([token]) =>
    requireSession(token).isAdmin
      ? { success: true, apiKey: ADMIN_SETTINGS.geminiApiKey }
      : { success: false, message: '権限がありません。' },
  getGeminiModelSettingsForAdmin: ([token]) =>
    requireSession(token).isAdmin
      ? { success: true, reportModel: ADMIN_SETTINGS.reportModel, ocrModel: ADMIN_SETTINGS.ocrModel }
      : { success: false, message: '権限がありません。' },
  getGoogleChatWebhookSettingsForAdmin: ([token]) =>
    requireSession(token).isAdmin
      ? {
          success: true,
          reportWebhookUrl: ADMIN_SETTINGS.reportWebhookUrl,
          receiptWebhookUrl: ADMIN_SETTINGS.receiptWebhookUrl,
        }
      : { success: false, message: '権限がありません。' },
  listAvailableGeminiModelsForAdmin: ([token]) =>
    requireSession(token).isAdmin
      ? { success: true, models: AVAILABLE_MODELS }
      : { success: false, message: '権限がありません。' },
  saveGeminiApiKeyForAdmin: () => ({ success: true, message: 'Gemini APIキーを保存しました。' }),
  saveGeminiModelSettingsForAdmin: () => ({ success: true, message: 'モデル設定を保存しました。' }),
  saveGoogleChatWebhookSettingsForAdmin: () => ({ success: true, message: 'Webhook URLを保存しました。' }),
};
