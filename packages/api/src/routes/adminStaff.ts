import type { StaffAdminResult } from '@katahimo/core';
import { createStaffByAdmin, listStaffForAdmin, updateStaffByAdmin } from '@katahimo/core';
import { createStaffRequestSchema, idSchema, updateStaffRequestSchema } from '@katahimo/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Container } from '../container';
import { requestMeta } from '../http/requestMeta';
import { apiError, parseJsonBody } from '../http/responses';
import type { SessionEnv } from '../session';
import { requireAdmin } from '../session';

const EMAIL_CONFLICT_MESSAGE = {
  email: 'このメールアドレスは他のスタッフが使用しています',
  altEmail: 'このサブメールは他のスタッフが使用しているか、メールアドレスと同じです',
} as const;

function respond(c: Context, result: StaffAdminResult, successStatus: 200 | 201) {
  if (result.ok) return c.json({ staff: result.staff }, successStatus);
  switch (result.reason) {
    case 'email_conflict':
      return apiError(c, 409, 'conflict', EMAIL_CONFLICT_MESSAGE[result.field], {
        [result.field]: EMAIL_CONFLICT_MESSAGE[result.field],
      });
    case 'not_found':
      return apiError(c, 404, 'not_found', 'スタッフが見つかりません');
    case 'cannot_demote_self':
      return apiError(c, 400, 'validation_failed', '自分自身の管理者権限は解除できません');
    case 'cannot_retire_self':
      return apiError(c, 400, 'validation_failed', '自分自身に退職日は設定できません');
  }
}

/** 管理者向けスタッフ管理(GAS版でスタッフ台帳シートを直接編集していた作業の置き換え)。 */
export function createAdminStaffRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  app.get('/', requireAdmin(container, 'staff.admin.list'), async (c) => {
    const session = c.get('session');
    return c.json({ staff: await listStaffForAdmin(container, session.tenantId) });
  });

  app.post('/', requireAdmin(container, 'staff.admin.create'), async (c) => {
    const session = c.get('session');
    const body = await parseJsonBody(c, createStaffRequestSchema);
    if (!body.ok) return body.response;
    const result = await createStaffByAdmin(
      container,
      { tenantId: session.tenantId, staffId: session.staffId, meta: requestMeta(c) },
      body.data,
    );
    return respond(c, result, 201);
  });

  app.patch('/:id', requireAdmin(container, 'staff.admin.update'), async (c) => {
    const session = c.get('session');
    const staffId = c.req.param('id');
    if (!idSchema.safeParse(staffId).success)
      return apiError(c, 404, 'not_found', 'スタッフが見つかりません');
    const body = await parseJsonBody(c, updateStaffRequestSchema);
    if (!body.ok) return body.response;
    const result = await updateStaffByAdmin(
      container,
      { tenantId: session.tenantId, staffId: session.staffId, meta: requestMeta(c) },
      staffId,
      body.data,
    );
    return respond(c, result, 200);
  });

  return app;
}
