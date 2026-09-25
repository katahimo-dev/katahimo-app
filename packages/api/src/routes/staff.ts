import { listActiveStaffForActor } from '@katahimo/core/usecases';
import { activeStaffListResponseSchema } from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { jsonOk } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireSession } from '../session';

export function createStaffRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /**
   * 「対象スタッフ」の選択肢(退職者を除く)。予定・勤怠タブのスタッフ選択に使う。他のスタッフを扱えない役割
   * (一般スタッフ)には空の一覧を返す(GAS版 getActiveStaffNamesForAdmin と同じ)。
   */
  app.get('/', requireSession(container), async (c) =>
    jsonOk(c, activeStaffListResponseSchema, { staff: await listActiveStaffForActor(container, actorOf(c)) }),
  );

  return app;
}
