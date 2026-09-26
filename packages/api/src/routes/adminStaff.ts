import {
  createStaffByAdmin,
  deleteStaffByAdmin,
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
  updateStaffRequestSchema,
} from '@katahimo/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Container } from '../container';
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
 * usecase の DomainError を app.onError が応答にする。
 */
export function createAdminStaffRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  app.get('/', requireAdmin(container, 'staff.admin.list'), async (c) =>
    jsonOk(c, adminStaffListResponseSchema, {
      staff: await listStaffForAdmin(container, c.get('session').tenantId),
    }),
  );

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
