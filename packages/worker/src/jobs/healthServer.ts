import { createServer, type Server } from 'node:http';

/**
 * Cloud Run サービスとして常駐させるためのヘルスチェック用HTTPサーバー。Cloud Run のサービスは
 * コンテナのポートで待ち受けないと起動失敗扱いになるため、outbox ポーラーと同じプロセスで最小限の応答だけ返す
 * (リクエストを受けて処理する用途は無い。外部から呼べないよう ingress=internal にする。doc/11)。
 */
export function startHealthServer(port: number): Server {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
  });
  server.listen(port);
  return server;
}
