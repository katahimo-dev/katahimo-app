import {
  AI_PROMPT_KEYS,
  ASSESSMENT_DEFINITIONS,
  activeStaffListResponseSchema,
  adminSettingsResponseSchema,
  changePasswordResponseSchema,
  customerDetailResponseSchema,
  customerHistoryResponseSchema,
  customerListResponseSchema,
  dataVersionResponseSchema,
  findAiPromptDefinition,
  generateAccidentReportResponseSchema,
  generateDailyReportResponseSchema,
  listGeminiModelsResponseSchema,
  okResponseSchema,
  passwordResetConfirmResponseSchema,
  passwordResetRequestResponseSchema,
  receiptOcrResponseSchema,
  saveAccidentReportResponseSchema,
  saveDailyReportResponseSchema,
  saveSettingsResponseSchema,
  scheduleLightResponseSchema,
  scheduleWithRouteResponseSchema,
  sessionUserResponseSchema,
  uiConfigResponseSchema,
  uploadReceiptsResponseSchema,
  visitCompleteResponseSchema,
} from '@katahimo/shared';
import type { BrowserContext, Route } from 'playwright-core';
import type { ZodTypeAny } from 'zod';
import { addDays } from './dates';
import {
  ADMIN_SETTINGS,
  AVAILABLE_MODELS,
  CUSTOMERS,
  customerReports,
  DATA_VERSION,
  type FixtureCustomer,
  type FixtureStaff,
  MOCK_PASSWORD,
  reportUuid,
  reservaCustomerDetails,
  routeAppointments,
  STAFF,
  TENANT,
} from './fixtures';
import { gasHandlers } from './gasMock';

/**
 * 新アプリ(packages/web)のAPIのモック。Playwright の route で /api/** を受け、fixtures.ts の
 * データから契約(@katahimo/shared のzodスキーマ)どおりの応答を返す。応答はスキーマで検証するので、
 * 契約が変わったらここで気づける。
 *
 * 各機能の担当は、自分の機能のAPIを `webHandlers` に足す(キーは 'GET /api/…'。パスの :id 等は
 * 正規表現で書く)。モックの無いAPIが呼ばれたら 404 を返してログに出す。
 */
export interface WebMockState {
  /** ログイン中のスタッフ(null = 未ログイン) */
  user: FixtureStaff | null;
  /** 「今日」(YYYY-MM-DD) */
  today: string;
}

export interface WebMockResponse {
  status?: number;
  body: unknown;
  /** 応答の形を検証するスキーマ(エラー応答では省略) */
  schema?: ZodTypeAny;
}

export interface WebMockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
  match: RegExpMatchArray;
  state: WebMockState;
}

type WebHandler = (req: WebMockRequest) => WebMockResponse;

/** 状態(撮影する場面)ごとに、特定のAPIの応答を差しかえる(キーは webHandlers と同じ)。 */
export type WebMockOverrides = Record<
  string,
  { status?: number; body?: unknown; delayMs?: number | 'never' }
>;

const unauthenticated: WebMockResponse = {
  status: 401,
  body: { code: 'unauthenticated', message: '未ログインです' },
};
const forbidden: WebMockResponse = { status: 403, body: { code: 'forbidden', message: '権限がありません' } };

const sessionBody = (s: FixtureStaff) => ({
  staff: { staffId: s.id, tenantId: TENANT.id, name: s.name, email: s.email, isAdmin: s.isAdmin },
});

const prompt = (key: (typeof AI_PROMPT_KEYS)[keyof typeof AI_PROMPT_KEYS]) =>
  findAiPromptDefinition(key)?.defaultBody ?? '';

function withUser(fn: (req: WebMockRequest, user: FixtureStaff) => WebMockResponse): WebHandler {
  return (req) => (req.state.user ? fn(req, req.state.user) : unauthenticated);
}

function withAdmin(fn: (req: WebMockRequest, user: FixtureStaff) => WebMockResponse): WebHandler {
  return withUser((req, user) => (user.isAdmin ? fn(req, user) : forbidden));
}

const saved = (message: string): WebMockResponse => ({
  body: { ok: true, changed: true, message },
  schema: saveSettingsResponseSchema,
});

/** 日報・領収書を保存したときに返すID(モックでは固定) */
const MOCK_REPORT_ID = '00000000-0000-4000-8000-0000000000d1';

export const webHandlers: Record<string, WebHandler> = {
  // ── 認証 ──
  'GET /api/auth/me': withUser((_req, user) => ({
    body: sessionBody(user),
    schema: sessionUserResponseSchema,
  })),
  'POST /api/auth/login': (req) => {
    const staff = STAFF.find((s) => s.email === String(req.body.email ?? '').trim());
    if (req.body.tenantSlug !== TENANT.slug || !staff || req.body.password !== MOCK_PASSWORD) {
      return {
        status: 401,
        body: { code: 'unauthenticated', message: 'メールアドレスまたはパスワードが違います' },
      };
    }
    req.state.user = staff;
    return { body: sessionBody(staff), schema: sessionUserResponseSchema };
  },
  'POST /api/auth/logout': (req) => {
    req.state.user = null;
    return { body: { ok: true }, schema: okResponseSchema };
  },
  'POST /api/auth/change-password': withUser((req) =>
    req.body.currentPassword === MOCK_PASSWORD
      ? { body: { success: true, message: 'パスワードを変更しました' }, schema: changePasswordResponseSchema }
      : { status: 400, body: { code: 'validation_failed', message: '現在のパスワードが正しくありません' } },
  ),
  'POST /api/auth/password-reset/request': () => ({
    body: {
      ok: true,
      message:
        '登録されているメールアドレスであれば、認証コードを送信しました。メールをご確認ください(有効期限30分)。',
    },
    schema: passwordResetRequestResponseSchema,
  }),
  'POST /api/auth/password-reset/confirm': (req) =>
    req.body.code === '123456'
      ? {
          body: { ok: true, message: 'パスワードを再設定しました' },
          schema: passwordResetConfirmResponseSchema,
        }
      : { status: 400, body: { code: 'validation_failed', message: '無効な認証コードです' } },

  // ── 共通 ──
  'GET /api/data-version': withUser(() => ({
    body: { dataVersion: DATA_VERSION },
    schema: dataVersionResponseSchema,
  })),
  'GET /api/ui-config': withUser(() => ({
    body: {
      dailyPlaceholder: prompt(AI_PROMPT_KEYS.DAILY_MEMO_PLACEHOLDER),
      accidentPlaceholder: prompt(AI_PROMPT_KEYS.ACCIDENT_MEMO_PLACEHOLDER),
      accidentHint: prompt(AI_PROMPT_KEYS.ACCIDENT_WRITING_HINT),
      hiyariPlaceholder: prompt(AI_PROMPT_KEYS.HIYARI_WRITING_HINT),
      assessments: ASSESSMENT_DEFINITIONS,
    },
    schema: uiConfigResponseSchema,
  })),
  'GET /api/staff': withUser((_req, user) => ({
    body: {
      staff: user.isAdmin
        ? STAFF.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => (a.name < b.name ? -1 : 1))
        : [],
    },
    schema: activeStaffListResponseSchema,
  })),

  // ── 管理者設定 ──
  'GET /api/settings/admin': withAdmin(() => ({
    body: {
      settings: {
        geminiApiKey: ADMIN_SETTINGS.geminiApiKey,
        geminiReportModel: ADMIN_SETTINGS.reportModel,
        geminiOcrModel: ADMIN_SETTINGS.ocrModel,
        gchatReportWebhookUrl: ADMIN_SETTINGS.reportWebhookUrl,
        gchatReceiptWebhookUrl: ADMIN_SETTINGS.receiptWebhookUrl,
      },
    },
    schema: adminSettingsResponseSchema,
  })),
  'POST /api/settings/admin/gemini-key': withAdmin(() => saved('Gemini APIキーを保存しました。')),
  'POST /api/settings/admin/gemini-models': withAdmin(() => saved('モデル設定を保存しました。')),
  'POST /api/settings/admin/gchat-webhooks': withAdmin(() => saved('Webhook URLを保存しました。')),
  'POST /api/settings/admin/gemini-models/available': withAdmin(() => ({
    body: { success: true, models: AVAILABLE_MODELS },
    schema: listGeminiModelsResponseSchema,
  })),

  // ── 予定(予定・お客様の担当) ──
  'GET /api/schedule': withUser((req) => ({
    body: {
      success: true,
      appointments: routeAppointments(scheduleOffsetOf(req)).map((a) => ({
        title: a.customerName,
        eventType: a.eventType,
        start: a.startTime,
        end: a.endTime,
        address: a.address,
      })),
    },
    schema: scheduleLightResponseSchema,
  })),
  'GET /api/schedule/route': withUser((req) => ({
    body: {
      success: true,
      appointments: routeAppointments(scheduleOffsetOf(req)).map((a) => ({
        eventType: a.eventType,
        customerName: a.customerName,
        startTime: a.startTime,
        endTime: a.endTime,
        reservaUrl: '',
        moveUrl: a.moveUrl ?? '',
        moveMin: a.moveMin ?? '',
        moveKm: a.moveKm ?? '',
        attendanceUrl: a.attendanceUrl ?? '',
        attendanceMin: a.attendanceMin ?? '',
        attendanceKm: a.attendanceKm ?? '',
        leavingUrl: a.leavingUrl ?? '',
        leavingMin: a.leavingMin ?? '',
        leavingKm: a.leavingKm ?? '',
        customerId: CUSTOMERS.find((c) => c.name === a.customerName)?.id ?? '',
        address: a.address,
      })),
    },
    schema: scheduleWithRouteResponseSchema,
  })),

  // ── お客様・これまでの記録(予定・お客様の担当) ──
  'GET /api/customers': withUser(() => ({
    body: {
      customers: CUSTOMERS.map((c) => ({ id: c.uuid, name: c.name, phone: c.phone, city: c.city })),
      cities: [...new Set(CUSTOMERS.map((c) => c.city))].sort(),
    },
    schema: customerListResponseSchema,
  })),
  'GET /api/customers/:id': withUser((req) => {
    const customer = CUSTOMERS.find((c) => c.uuid === req.match[1]);
    if (!customer) return { status: 404, body: { code: 'not_found', message: '顧客が見つかりません' } };
    return { body: { customer: customerDetailView(customer) }, schema: customerDetailResponseSchema };
  }),
  'GET /api/reports/history': withUser((req) => {
    const index = CUSTOMERS.findIndex((c) => c.uuid === req.query.get('customerId'));
    const customer = CUSTOMERS[index];
    if (!customer) return { body: { items: [] }, schema: customerHistoryResponseSchema };
    const before = req.query.get('before');
    const items = customerReports(customer.id, req.state.today)
      .map((r, i) => ({
        type: r.type,
        id: reportUuid(index, i),
        occurredAtIso: jstTimestampToIso(r.timestamp),
        timestamp: r.timestamp,
        staff: r.staff,
        original: r.original,
        internal: r.internal,
        customer: r.customer,
        ...(r.type === 'daily'
          ? { risk: r.risk ?? null, es: r.es ?? null }
          : { isAccident: true, subtype: r.subtype ?? '事故報告' }),
      }))
      .filter((item) => !before || item.occurredAtIso < new Date(before).toISOString())
      .slice(0, 5);
    return { body: { items }, schema: customerHistoryResponseSchema };
  }),

  // ── 日報・事故報告・領収書(日報の担当) ──
  // AIの下書き・OCRの結果はGAS版のモック(gasMock.ts)と同じ値を返す(両方の画面に同じ文が出るように)。
  'POST /api/reports/daily/generate': withUser(() => ({
    body: { draft: gasHandlers.generateReportWithWarnings?.([], { today: '' }) },
    schema: generateDailyReportResponseSchema,
  })),
  'POST /api/reports/accident/generate': withUser(() => ({
    body: { draft: gasHandlers.generateAccidentReport?.([], { today: '' }) },
    schema: generateAccidentReportResponseSchema,
  })),
  'POST /api/reports/daily': withUser((req, user) => ({
    body: {
      success: true,
      message: '保存しました',
      report: {
        id: String(req.body.reportId ?? MOCK_REPORT_ID),
        occurredAt: `${req.state.today}T01:00:00.000Z`,
        staffId: user.id,
        customerId: String(req.body.customerId),
        riskRating: (req.body.riskRating as number | null) ?? null,
        esRating: (req.body.esRating as number | null) ?? null,
        content: {
          startTime: String(req.body.startTime ?? ''),
          endTime: String(req.body.endTime ?? ''),
          inputText: String(req.body.inputText ?? ''),
          internalText: String(req.body.internalText ?? ''),
          customerText: String(req.body.customerText ?? ''),
        },
      },
    },
    schema: saveDailyReportResponseSchema,
  })),
  'POST /api/reports/accident': withUser((req, user) => ({
    body: {
      success: true,
      report: {
        id: String(req.body.reportId ?? MOCK_REPORT_ID),
        occurredAt: `${req.state.today}T01:00:00.000Z`,
        staffId: user.id,
        customerId: String(req.body.customerId),
        reportType: String(req.body.reportType ?? '事故報告'),
        content: {},
      },
    },
    schema: saveAccidentReportResponseSchema,
  })),
  'POST /api/reports/visit-complete': withUser(() => ({
    body: { success: true },
    schema: visitCompleteResponseSchema,
  })),
  'POST /api/receipts/ocr': withUser(() => ({
    body: { result: gasHandlers.extractAmountFromImage?.([], { today: '' }) },
    schema: receiptOcrResponseSchema,
  })),
  'POST /api/receipts': withUser((req) => {
    const count = Array.isArray(req.body.images) ? req.body.images.length : 0;
    return {
      body: {
        success: true,
        message: '領収書を送りました',
        uploadedCount: count,
        duplicateCount: 0,
        duplicates: [],
        uploadBatchId: MOCK_REPORT_ID,
      },
      schema: uploadReceiptsResponseSchema,
    };
  }),
};

/** 予定のAPIの date が「今日」なら 0、「明日」なら 1(fixtures の routeAppointments の offset)。 */
function scheduleOffsetOf(req: WebMockRequest): number {
  const date = req.query.get('date');
  return date === req.state.today ? 0 : date === addDays(req.state.today, 1) ? 1 : -1;
}

/** 'yyyy/MM/dd HH:mm'(JST)→ ISO8601 */
function jstTimestampToIso(timestamp: string): string {
  const [date = '', time = '00:00'] = timestamp.split(' ');
  return new Date(`${date.replace(/\//g, '-')}T${time}:00+09:00`).toISOString();
}

/**
 * GET /api/customers/:id の customer。GAS版の details(fixtures の reservaCustomerDetails)と同じ値を
 * 項目ごとに入れる(両方の「お客様の情報」が同じ内容になるように)。
 */
function customerDetailView(c: FixtureCustomer) {
  const details = new Map(reservaCustomerDetails(c).map((d) => [d.key, d.value]));
  const v = (key: string) => details.get(key) || null;
  const registered = v('登録日時');
  return {
    id: c.uuid,
    externalSource: 'reserva',
    externalId: c.id,
    name: c.name,
    familyNameKana: v('姓（カナ）※必須項目'),
    givenNameKana: v('名（カナ）※必須項目'),
    email: v('メールアドレス'),
    phone: v('電話番号※必須項目'),
    addressDetail: v('住所'),
    city: c.city,
    parkingArea: v('駐車場'),
    parkingDetail: v('駐車場番号・指定場所の詳細など'),
    emergencyContact: v('緊急連絡先'),
    emergencyContactRelation: v('緊急連絡先の方（申請者との関係性）'),
    evacuationSite: v('災害時の避難場所（最寄りの小中学校）'),
    memo: v('顧客メモ'),
    benefitMemberId: v('Benefit会員ID'),
    address2: v('住所2'),
    address2StartDate: null,
    address2EndDate: null,
    latLng: v('緯度・経度'),
    memberType: v('会員種別'),
    memberStatus: v('会員状況（有効／無効）'),
    paymentMethod: v('会費支払方法（現地決済／銀行振込／口座振替／請求書払い）'),
    paymentStatus: v('会費支払状況（未払／支払済み）'),
    gender: v('性別'),
    ageBracket: v('年代'),
    registeredAt: registered ? jstTimestampToIso(registered) : null,
    externalLastUpdatedAt: null,
    deactivatedAt: null,
    familyMembers: c.family.map((f, i) => ({
      id: reportUuid(90, i + CUSTOMERS.indexOf(c) * 10),
      name: f.name,
      dob: f.dob || null,
      info: f.info || null,
      allergy: f.allergy || null,
    })),
  };
}

/** キー 'GET /api/customers/:id' のような書き方を正規表現にする。 */
function compileKey(key: string): { method: string; pattern: RegExp } {
  const [method = 'GET', path = '/'] = key.split(' ');
  const pattern = new RegExp(`^${path.replace(/:[a-zA-Z]+/g, '([^/]+)')}$`);
  return { method, pattern };
}

const compiled = Object.entries(webHandlers).map(([key, handler]) => ({ key, handler, ...compileKey(key) }));

export async function installWebMock(
  context: BrowserContext,
  state: WebMockState,
  overrides: WebMockOverrides = {},
) {
  await context.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const entry = compiled.find((c) => c.method === method && c.pattern.test(url.pathname));
      if (!entry) {
        console.warn(
          `[gas-preview] モックの無いAPIが呼ばれました: ${method} ${url.pathname} (src/webMock.ts に追加してください)`,
        );
        await route.fulfill({ status: 404, json: { code: 'not_found', message: 'モックがありません' } });
        return;
      }
      const override = overrides[entry.key];
      if (override?.delayMs === 'never') return; // 応答しない(読み込み中のまま)
      let result: WebMockResponse;
      if (override && 'body' in override) {
        result = { status: override.status ?? 200, body: override.body };
      } else {
        const body = (() => {
          try {
            return (request.postDataJSON() ?? {}) as Record<string, unknown>;
          } catch {
            return {};
          }
        })();
        result = entry.handler({
          method,
          path: url.pathname,
          query: url.searchParams,
          body,
          match: url.pathname.match(entry.pattern) as RegExpMatchArray,
          state,
        });
        if (result.schema && (result.status ?? 200) < 400) {
          const parsed = result.schema.safeParse(result.body);
          if (!parsed.success) {
            throw new Error(
              `${entry.key} のモック応答が契約と一致しません: ${JSON.stringify(parsed.error.issues)}`,
            );
          }
        }
      }
      const delayMs = override?.delayMs;
      if (typeof delayMs === 'number') await new Promise((r) => setTimeout(r, delayMs));
      await route.fulfill({ status: result.status ?? 200, json: result.body });
    },
  );
}
