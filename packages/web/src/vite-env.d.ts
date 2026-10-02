/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  /** ログインに使う法人IDの既定値(src/lib/tenant.ts) */
  readonly VITE_DEFAULT_TENANT_SLUG?: string;
  /** サブドメインで法人を見分けるときのベースドメイン(src/lib/tenant.ts) */
  readonly VITE_TENANT_BASE_DOMAIN?: string;
  /** '1' なら公開デモ用のビルド(ログイン画面にデモ用アカウントを出す。src/lib/demo.ts) */
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** アプリの版数(package.json の version。vite.config.ts の define で埋め込む)。設定画面に出す。 */
declare const __APP_VERSION__: string;
