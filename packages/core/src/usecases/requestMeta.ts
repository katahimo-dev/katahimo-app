/** アプリログに添える、HTTPリクエストの送信元情報(APIルートが組み立てて渡す)。 */
export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** 操作者(セッションから解決済み)。クライアントが送ってきたスタッフIDではない。 */
export interface Actor {
  staffId: string;
  isAdmin: boolean;
}
