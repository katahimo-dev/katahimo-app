/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** ログインに使う法人IDの既定値(src/lib/tenant.ts) */
  readonly VITE_DEFAULT_TENANT_SLUG?: string;
  /** サブドメインで法人を見分けるときのベースドメイン(src/lib/tenant.ts) */
  readonly VITE_TENANT_BASE_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** アプリの版数(package.json の version。vite.config.ts の define で埋め込む)。設定画面に出す。 */
declare const __APP_VERSION__: string;
