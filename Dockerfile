# katahimo-app の本番イメージ(Cloud Run)。ターゲットは2つ:
#   api    … API サーバー + ビルド済みWeb画面(同一オリジンで配信)
#            docker build --target api -t katahimo-api .
#   worker … outbox ポーラー(既定のコマンド)と Cloud Run Jobs 用のジョブ(migrate / 夜間バッチ)
#            docker build --target worker -t katahimo-worker .
#            docker run katahimo-worker                      # 常駐ポーラー
#            docker run katahimo-worker db/dist/migrate.js   # マイグレーション
#            docker run katahimo-worker dist/nightly-calendar-sync.js [YYYY-MM-DD]
# 手順と構成は doc/11_GCPデプロイ手順.md。

# ── ベースイメージ ────────────────────────────────────────────
# 再現できるビルドのためダイジェストで固定する(タグは読む人のための目印)。ダイジェストの更新は
# Dependabot(.github/dependabot.yml の docker)が週1回 PR にする。Node のメジャー更新は手で行う。
# ビルド・実行とも同じイメージを使い、ここ1か所だけを書き換えればよいようにする。
#
# PID 1 について: tini 等の init は入れない。api / worker とも SIGTERM を自分で処理して終了し
# (packages/api/src/server.ts・packages/worker/src/main.ts)、子プロセスも作らないため、ゾンビの回収も要らない。
# Cloud Run は停止時にコンテナの PID 1 へ SIGTERM を送る。手元の docker run で Ctrl+C(SIGINT)を効かせたい
# ときは `docker run --init` を使う(PID 1 の node は SIGINT の既定動作を行わないため)。
#
# HEALTHCHECK も書かない: Cloud Run は Dockerfile の HEALTHCHECK を使わず、infra/gcp/run.tf の
# startup_probe / liveness_probe(api は /api/health、worker は TCP)で確認する。
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS base

# ── pnpm の入ったビルド用ベース ──────────────────────────────────
FROM base AS pnpm
# package.json の packageManager と同じ版
ARG PNPM_VERSION=11.23.0
ENV CI=true
RUN npm install -g pnpm@${PNPM_VERSION} && npm cache clean --force
WORKDIR /repo

# ── ワークスペースの manifest だけ(依存のインストールをソースの変更から切り離してキャッシュさせる) ──
FROM pnpm AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ingestion/package.json packages/ingestion/
COPY packages/integrations/package.json packages/integrations/
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/
COPY packages/worker/package.json packages/worker/

# ── ビルド(全依存を入れ、tsup / vite で dist を作る) ─────────────
FROM manifests AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @katahimo/api --filter @katahimo/worker --filter @katahimo/db build

FROM build AS build-web
RUN pnpm --filter @katahimo/web build

# ── 本番依存だけ(バンドルに含めない googleapis 等)。ルートの node_modules に平坦に置き、
#    /app/dist/*.js から親ディレクトリをたどって解決できるようにする(node-linker=hoisted)。
#    @katahimo/* はバンドル済みで、そのリンクは packages/*/node_modules 側に作られるため持ち込まない。
FROM manifests AS prod-deps-api
RUN pnpm install --prod --frozen-lockfile --config.node-linker=hoisted --filter '@katahimo/api...'

FROM manifests AS prod-deps-worker
RUN pnpm install --prod --frozen-lockfile --config.node-linker=hoisted \
    --filter '@katahimo/worker...' --filter '@katahimo/db...'

# ── 実行用ベース(pnpm・ソースを含まない。root 所有の読み取り専用ファイルを node ユーザーで実行) ──
FROM base AS runtime
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

# ── api ─────────────────────────────────────────────────────
FROM runtime AS api
ENV PORT=8080 \
    WEB_DIST_DIR=/app/web
COPY --from=prod-deps-api /repo/node_modules ./node_modules
COPY --from=build /repo/packages/api/dist ./dist
COPY --from=build-web /repo/packages/web/dist ./web
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]

# ── worker ──────────────────────────────────────────────────
# db/dist/migrate.js は ../drizzle(マイグレーションSQL)を読むため同じ相対位置に置く。
FROM runtime AS worker
COPY --from=prod-deps-worker /repo/node_modules ./node_modules
COPY --from=build /repo/packages/worker/dist ./dist
COPY --from=build /repo/packages/db/dist ./db/dist
COPY --from=build /repo/packages/db/drizzle ./db/drizzle
USER node
ENTRYPOINT ["node"]
CMD ["dist/main.js"]
