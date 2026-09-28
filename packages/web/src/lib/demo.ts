/**
 * 公開デモ用のビルドか(`VITE_DEMO_MODE=1`)。ログイン画面にデモ用アカウントを出し、画面の上に「デモ環境」の帯を出す。
 * デモの制限(パスワードの変更等を断る)は API が `DEMO_TENANT_SLUG` のテナントに掛ける。ここは表示だけ。
 */
export function isDemoMode(): boolean {
  return import.meta.env.VITE_DEMO_MODE === '1';
}

/** デモ環境の注意書き(ログイン画面と画面上の帯)。 */
export const DEMO_NOTICE =
  'デモ環境です。データは架空のもので、毎晩作り直します。入力した内容は他の閲覧者にも見えます。';
