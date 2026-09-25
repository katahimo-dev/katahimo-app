import type { StaffRole } from '../domain/model';

/** アプリログに添える、HTTPリクエストの送信元情報(APIルートが組み立てて渡す)。 */
export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** 操作者(セッションから解決済み)。クライアントが送ってきたスタッフIDではない。 */
export interface Actor {
  tenantId: string;
  staffId: string;
  role: StaffRole;
  meta?: RequestMeta;
}

/** usecase の「今」(テストでは now で固定する)。 */
export interface Clock {
  now?: () => Date;
}

export function currentTime(deps: Clock): Date {
  return deps.now ? deps.now() : new Date();
}
