import {
  createStaffByAdmin,
  deleteStaffByAdmin,
  exportStaffSheet,
  importStaffSheet,
  listStaffForAdmin,
  sendPasswordGuideByAdmin,
  updateStaffByAdmin,
} from '@katahimo/core/usecases';
import {
  adminStaffListResponseSchema,
  adminStaffResponseSchema,
  createStaffRequestSchema,
  idSchema,
  okResponseSchema,
  staffImportRequestSchema,
  staffImportResponseSchema,
  updateStaffRequestSchema,
} from '@katahimo/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Container } from '../container';
import { buildStaffWorkbook, readStaffWorkbook } from '../export/staffWorkbook';
import { xlsxResponse } from '../http/download';
import { enforceStaffQuota } from '../http/quota';
import { apiError, jsonOk, parseJsonBody, rateLimited } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireAdmin } from '../session';

/** パスの :id(UUID でなければ存在しないスタッフと同じ 404)。 */
function staffIdOf(c: Context): string | null {
  const parsed = idSchema.safeParse(c.req.param('id'));
  return parsed.success ? parsed.data : null;
}

const STAFF_NOT_FOUND = 'スタッフが見つかりません';

/**
 * 管理者向けスタッフ管理(GAS版でスタッフ台帳シートを直接編集していた作業の置き換え。画面は「🛠 管理」→
 * 「スタッフ」)。メールの重複・古い版での保存・記録のあるスタッフの削除(409)、自分自身の降格/退職/削除(400)は
 * usecase の DomainError を app.onError が応答にする。xlsx の書き出し(export.xlsx)・取込(import。先に確かめる)もここ。
 */
export function createAdminStaffRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  app.get('/', requireAdmin(container, 'staff.admin.list'), async (c) =>
    jsonOk(c, adminStaffListResponseSchema, {
      staff: await listStaffForAdmin(container, c.get('session').tenantId),
    }),
  );

  app.get('/export.xlsx', requireAdmin(container, 'staff.export'), async (c) => {
    const body = await buildStaffWorkbook(await exportStaffSheet(container, actorOf(c)));
    return xlsxResponse(c, body, 'スタッフ一覧.xlsx', 'staff.xlsx');
  });

  app.post('/import', requireAdmin(container, 'staff.xlsx_import'), async (c) => {
    const body = await parseJsonBody(c, staffImportRequestSchema);
    if (!body.ok) return body.response;
    if (!body.data.dryRun) {
      // 反映だけを数える(確かめるだけは何も書かず、地図APIも呼ばない)
      const limited = await enforceStaffQuota(
        c,
        container,
        container.rateLimits.staffImportApplyStaff,
        'スタッフの取込の反映の回数の上限に達しました。少し時間をおいてからもう一度お試しください。',
      );
      if (limited) return limited;
    }
    const sheets = await readStaffWorkbook(Buffer.from(body.data.fileBase64, 'base64'));
    const result = await importStaffSheet(container, actorOf(c), {
      sheets,
      dryRun: body.data.dryRun,
      fileName: body.data.fileName ?? null,
      planDigest: body.data.planDigest ?? null,
    });
    return jsonOk(c, staffImportResponseSchema, result);
  });

  app.post('/', requireAdmin(container, 'staff.admin.create'), async (c) => {
    const body = await parseJsonBody(c, createStaffRequestSchema);
    if (!body.ok) return body.response;
    const { initialPassword, ...fields } = body.data;
    const result = await createStaffByAdmin(container, actorOf(c), {
      ...fields,
      ...(initialPassword ? { initialPassword } : {}),
    });
    return jsonOk(c, adminStaffResponseSchema, result, 201);
  });

  app.patch('/:id', requireAdmin(container, 'staff.admin.update'), async (c) => {
    const staffId = staffIdOf(c);
    if (!staffId) return apiError(c, 404, 'not_found', STAFF_NOT_FOUND);
    const body = await parseJsonBody(c, updateStaffRequestSchema);
    if (!body.ok) return body.response;
    return jsonOk(
      c,
      adminStaffResponseSchema,
      await updateStaffByAdmin(container, actorOf(c), staffId, body.data),
    );
  });

  app.delete('/:id', requireAdmin(container, 'staff.admin.delete'), async (c) => {
    const staffId = staffIdOf(c);
    if (!staffId) return apiError(c, 404, 'not_found', STAFF_NOT_FOUND);
    await deleteStaffByAdmin(container, actorOf(c), staffId);
    return jsonOk(c, okResponseSchema, { ok: true });
  });

  app.post('/:id/password-guide', requireAdmin(container, 'staff.admin.password_guide'), async (c) => {
    const staffId = staffIdOf(c);
    if (!staffId) return apiError(c, 404, 'not_found', STAFF_NOT_FOUND);
    const outcome = await sendPasswordGuideByAdmin(container, actorOf(c), staffId);
    if (outcome.status === 'rate_limited') {
      return rateLimited(
        c,
        outcome.retryAfterMs,
        '案内のメールを送る回数の上限に達しました。時間をおいてください',
      );
    }
    return jsonOk(c, okResponseSchema, { ok: true });
  });

  return app;
}
