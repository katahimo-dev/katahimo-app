import { createStaffByAdmin, listStaffForAdmin, updateStaffByAdmin } from '@katahimo/core/usecases';
import {
  adminStaffListResponseSchema,
  adminStaffResponseSchema,
  createStaffRequestSchema,
  idSchema,
  updateStaffRequestSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { apiError, jsonOk, parseJsonBody } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireAdmin } from '../session';

/**
 * 管理者向けスタッフ管理(GAS版でスタッフ台帳シートを直接編集していた作業の置き換え)。メールの重複(409)・
 * 自分自身の降格/退職(400)は usecase の DomainError を app.onError が応答にする。
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
    const staff = await createStaffByAdmin(container, actorOf(c), {
      ...fields,
      ...(initialPassword ? { initialPassword } : {}),
    });
    return jsonOk(c, adminStaffResponseSchema, { staff }, 201);
  });

  app.patch('/:id', requireAdmin(container, 'staff.admin.update'), async (c) => {
    const staffId = idSchema.safeParse(c.req.param('id'));
    if (!staffId.success) return apiError(c, 404, 'not_found', 'スタッフが見つかりません');
    const body = await parseJsonBody(c, updateStaffRequestSchema);
    if (!body.ok) return body.response;
    const staff = await updateStaffByAdmin(container, actorOf(c), staffId.data, body.data);
    return jsonOk(c, adminStaffResponseSchema, { staff });
  });

  return app;
}
