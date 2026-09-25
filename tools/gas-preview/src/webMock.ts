import {
  AI_PROMPT_KEYS,
  ASSESSMENT_DEFINITIONS,
  activeStaffListResponseSchema,
  adminSettingsResponseSchema,
  attendanceDayResponseSchema,
  attendanceMonthResponseSchema,
  attendanceWeekResponseSchema,
  calendarSyncApplyResponseSchema,
  calendarSyncPreviewResponseSchema,
  changePasswordResponseSchema,
  dataVersionResponseSchema,
  findAiPromptDefinition,
  listGeminiModelsResponseSchema,
  okResponseSchema,
  passwordResetConfirmResponseSchema,
  passwordResetRequestResponseSchema,
  saveSettingsResponseSchema,
  sessionUserResponseSchema,
  uiConfigResponseSchema,
  updateAttendanceDayResponseSchema,
} from '@katahimo/shared';
import type { BrowserContext, Route } from 'playwright-core';
import type { ZodTypeAny } from 'zod';
import { addDays, daysInMonth } from './dates';
import {
  ADMIN_SETTINGS,
  AVAILABLE_MODELS,
  attendanceRow,
  calendarSyncChanges,
  DATA_VERSION,
  type FixtureStaff,
  MOCK_PASSWORD,
  monthReceipts,
  STAFF,
  TENANT,
  WEATHER_OPTIONS,
} from './fixtures';
import { loadGasPureFunctions, type RowData } from './gasRuntime';

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

  // ── 出勤簿(下の attendanceWebHandlers) ──
  ...attendanceWebHandlers(),
};

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

// ── 出勤簿(出勤簿の担当)。GAS版モック(gasMock.ts)と同じ fixtures・同じGAS版の計算から作る ──

/** 管理者が staffId を指定した場合だけその人、それ以外は本人(API resolveAttendanceTargetStaffId と同じ)。 */
function attendanceTarget(req: WebMockRequest, user: FixtureStaff): FixtureStaff {
  const requested = String(req.query.get('staffId') ?? req.body.staffId ?? '');
  if (!user.isAdmin || !requested) return user;
  return STAFF.find((s) => s.id === requested) ?? user;
}

/** 列の値を契約の形(文字列)にする */
function toContractRow(row: RowData): Record<string, string> {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)]),
  );
}

/** GAS版 computeDayDerived の値(null があれば '' にする) */
function derivedOf(row: RowData) {
  const derived = loadGasPureFunctions().computeDayDerived(row);
  return Object.fromEntries(Object.entries(derived).map(([k, v]) => [k, v === null ? '' : v]));
}

/** 当月(今日が属する月)の1日〜末日だけ直せる */
function attendanceEditableRange(today: string) {
  const ym = today.slice(0, 7);
  return { from: `${ym}-01`, to: `${ym}-${String(daysInMonth(ym)).padStart(2, '0')}` };
}

function attendanceDayBody(date: string, staff: FixtureStaff, today: string) {
  const row = attendanceRow(date, today);
  const range = attendanceEditableRange(today);
  return {
    businessDate: date,
    staffId: staff.id,
    staffName: staff.name,
    found: true,
    rowData: toContractRow(row),
    derived: derivedOf(row),
    changedFields: [],
    editable: date >= range.from && date <= range.to,
    editableFrom: range.from,
    editableTo: range.to,
    optionsI: WEATHER_OPTIONS,
    optionsR: WEATHER_OPTIONS,
  };
}

function attendanceWebHandlers(): Record<string, WebHandler> {
  return {
    'GET /api/attendance/week': withUser((req) => {
      const start = String(req.query.get('start'));
      const end = String(req.query.get('end'));
      const gas = loadGasPureFunctions();
      const events: unknown[] = [];
      for (let d = start; d <= end; d = addDays(d, 1)) {
        events.push(...gas.buildScheduleEventsFromRowData_(d, attendanceRow(d, req.state.today)));
      }
      return { body: { events }, schema: attendanceWeekResponseSchema };
    }),
    'GET /api/attendance/day': withUser((req, user) => ({
      body: {
        attendance: attendanceDayBody(
          String(req.query.get('date')),
          attendanceTarget(req, user),
          req.state.today,
        ),
      },
      schema: attendanceDayResponseSchema,
    })),
    'PUT /api/attendance/day': withUser((req, user) => {
      const date = String(req.body.date);
      const range = attendanceEditableRange(req.state.today);
      if (date < range.from) {
        return {
          status: 400,
          body: {
            code: 'locked',
            message: `修正期限切れです。当月(${range.from.slice(5).replace('-', '/')})より前の記録は変更できません。`,
          },
        };
      }
      const changedColumns = Object.keys((req.body.rowData as Record<string, unknown>) ?? {});
      return {
        body: {
          attendance: attendanceDayBody(date, attendanceTarget(req, user), req.state.today),
          changedCount: changedColumns.length,
          changedColumns,
          message: '修正しました。',
        },
        schema: updateAttendanceDayResponseSchema,
      };
    }),
    'GET /api/attendance/month': withUser((req, user) => {
      const ym = String(req.query.get('month'));
      const staff = attendanceTarget(req, user);
      const gas = loadGasPureFunctions();
      const rows = Array.from({ length: daysInMonth(ym) }, (_, i) => {
        const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
        return { date, row: attendanceRow(date, req.state.today) };
      });
      const totals = gas.computeMonthlyTotals(
        rows.map(({ row }) => ({ rowData: row, derived: gas.computeDayDerived(row) })),
      );
      return {
        body: {
          month: {
            yearMonth: ym,
            staffId: staff.id,
            staffName: staff.name,
            days: rows.map(({ date, row }) => ({
              businessDate: date,
              rowData: toContractRow(row),
              derived: derivedOf(row),
            })),
            totals,
            receipts: monthReceipts(ym, req.state.today),
          },
        },
        schema: attendanceMonthResponseSchema,
      };
    }),
    'GET /api/attendance/day/calendar-sync/preview': withUser((req, user) => {
      const date = String(req.query.get('date'));
      const staff = attendanceTarget(req, user);
      const changes = calendarSyncChanges(date, req.state.today).map((c) => ({
        column: c.col,
        label: c.label,
        oldValue: c.oldValue,
        newValue: c.newValue,
      }));
      return {
        body: {
          staffId: staff.id,
          staffName: staff.name,
          date,
          appointmentCount: 4,
          hasChanges: changes.length > 0,
          changes,
        },
        schema: calendarSyncPreviewResponseSchema,
      };
    }),
    'POST /api/attendance/day/calendar-sync': withUser((req, user) => {
      const date = String(req.body.date);
      const staff = attendanceTarget(req, user);
      const changes = calendarSyncChanges(date, req.state.today).map((c) => ({
        column: c.col,
        label: c.label,
        oldValue: c.oldValue,
        newValue: c.newValue,
      }));
      return {
        body: {
          staffId: staff.id,
          staffName: staff.name,
          date,
          appointmentCount: 3,
          changedCount: changes.length,
          changes,
        },
        schema: calendarSyncApplyResponseSchema,
      };
    }),
  };
}
