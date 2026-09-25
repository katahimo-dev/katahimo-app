/**
 * PII(個人情報)の暗号化・検索用ポート。
 *
 * 対象: 氏名・メールアドレス・電話番号・市区町村レベルの住所など、漏洩時に個人の特定に
 * つながる項目(doc/07 第7章のカルテ本文・アレルギー等の要配慮個人情報も同様に対象)。
 *
 * 設計方針:
 * - 実データは常に CryptoPort でランダム化暗号化(AES-256-GCM相当)して保存する。同じ平文でも
 *   暗号文が毎回変わるため、鍵を持たない攻撃者は暗号文の一致パターンから何も読み取れない。
 *   決定的暗号化(同じ平文→同じ暗号文)を実値にそのまま使うと、日本の姓のように偏りの大きい
 *   データでは出現頻度からの統計的な逆引きが可能になってしまうため、実値には使わない。
 * - 等値検索が必要な項目だけ、BlindIndexPort で計算した値を別カラム(例: email_blind_index)に
 *   持たせ、検索はそちらに対して行う(WHERE email_blind_index = ?)。
 * - 氏名は「苗字だけで検索する」運用があるため、姓・名を分割してそれぞれ独立に
 *   ブラインドインデックスを持たせる(domain/pii/japaneseName.ts 参照)。
 * - 鍵(DEK)はテナントごとにランダム生成し、KeyManagementPort(./kms.ts)でKEKラップした状態で
 *   保存する(エンベロープ暗号化。packages/db/src/schema/tenantKeys.ts参照)。旧実装(マスターキー
 *   1本からSHA256でテナント鍵を決定的に導出)は、マスターキーが漏れれば全テナントの鍵を
 *   誰でも計算できてしまい、鍵を1本共有しているのと実質同じだったため廃止した(2026-08
 *   データベース構造レビューで指摘)。テナント解約時はDEKのレコードそのものを破棄するだけで、
 *   バックアップに残った暗号文も含めて復号不能にできる(暗号学的削除)。CryptoPortと
 *   BlindIndexPortは鍵を分ける想定(暗号化鍵の漏洩だけではブラインドインデックスから平文を
 *   復元できず、逆にインデックス鍵の漏洩だけでは実値を復号できない、という権限分離のため)。
 *
 * このポートの実装は @katahimo/integrations に置く。ローカル開発・PoCは環境変数1本のKEKで
 * DEKをラップする `LocalKmsPort`、本番はCloud KMSでラップする実装に差し替える(Phase 5、
 * 実際のGCPプロジェクト・KMSキーリングが用意でき次第。KeyManagementPortのインターフェースは
 * 変えずに済む設計にしてある)。
 */

export interface EncryptedValue {
  /** Base64エンコードされた暗号文(nonce・authタグ込み)。 */
  ciphertext: string;
  /** 復号に使うDEKのバージョン。ローテーション時に旧バージョンの暗号文を新鍵で再暗号化するために必要。 */
  keyVersion: number;
}

export interface CryptoPort {
  encrypt(tenantId: string, plaintext: string): Promise<EncryptedValue>;
  decrypt(tenantId: string, value: EncryptedValue): Promise<string>;
}

export interface BlindIndexPort {
  /**
   * 正規化済みの値から検索用ブラインドインデックスを計算する。
   * 呼び出し側は必ず domain/pii/normalize.ts 等で正規化してから渡すこと
   * (正規化がずれると同一人物なのにインデックスが一致しなくなる)。
   */
  compute(tenantId: string, normalizedValue: string): Promise<string>;
}
