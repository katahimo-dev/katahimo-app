import { createHmac } from 'node:crypto';

/**
 * 検索用ブラインドインデックスを計算する(HMAC-SHA256、鍵付き一方向関数)。
 *
 * 決定的暗号化(同じ平文なら常に同じ暗号文)を実値の保存にそのまま使うと、鍵を持たない
 * 攻撃者でも暗号文の出現頻度から平文を統計的に推測できてしまう(日本の姓は偏りが大きく、
 * 「この暗号文=佐藤さん」のような逆引きが現実的なリスクになる)。
 *
 * そこで実値は常にランダム化暗号(CryptoPort、AES-256-GCM相当)で保存し、等値検索が
 * 必要な項目(氏名の姓・メール・電話・市区町村等)だけ、この関数で計算した値を別カラムに
 * 持たせて検索する。HMACは一方向関数なので、この値単体からは平文を復元できない。
 * さらにテナントごとに鍵を分けることで、あるテナントの鍵が漏れても他テナントの
 * 一致関係(誰と誰が同じ電話番号か等)は漏れない。
 *
 * 呼び出し側は必ず ./normalize.ts の関数等で正規化した値を渡すこと。正規化がずれると
 * 同一人物なのにインデックスが一致しなくなる。
 */
export function computeBlindIndex(normalizedValue: string, key: Buffer): string {
  return createHmac('sha256', key).update(normalizedValue, 'utf8').digest('hex');
}
