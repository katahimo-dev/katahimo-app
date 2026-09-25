import { normalizeStaffName } from '../staffName';

export interface SplitName {
  familyName: string;
  givenName: string;
  /**
   * 区切り(空白)が見つからず分割できなかった場合true。
   * 現行データ(顧客DB_New等)は「姓 名」の間に必ず空白が入っている保証がないため、
   * 移行時の取込ではisAmbiguous=trueの行を人手レビュー対象にする
   * (doc/07 第8章、取込パイプラインの安全装置と同じ考え方)。
   */
  isAmbiguous: boolean;
}

/**
 * 「姓 名」形式の氏名を、最初の空白(全角/半角)で姓と名に分割する。
 *
 * 現場スタッフが「苗字だけで顧客を検索する」運用があるため、氏名全体のブラインドインデックスとは
 * 別に、姓だけのブラインドインデックスを持たせる必要がある。この関数はその下ごしらえ。
 * 部分一致/前方一致(例:「佐」で「佐藤」にヒット)は等値ベースのブラインドインデックスでは
 * 実現できないが、「姓トークン単位の完全一致」であればこの分割で十分満たせる。
 */
export function splitJapaneseFullName(rawFullName: string): SplitName {
  const normalized = rawFullName.normalize('NFKC').trim();
  const match = normalized.match(/^(\S+)[ \t\u3000]+(\S.*)$/);
  if (!match) {
    return { familyName: normalizeStaffName(normalized), givenName: '', isAmbiguous: true };
  }
  const [, family, given] = match;
  return {
    familyName: normalizeStaffName(family),
    givenName: normalizeStaffName(given),
    isAmbiguous: false,
  };
}
