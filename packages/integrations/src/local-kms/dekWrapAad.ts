/**
 * DEKのラップに結び付ける追加認証データ(AAD)。LocalKmsPort・CloudKmsPortで共通。
 * テナントIDを含め、あるテナントの wrapped_dek を別のテナントの行にコピーしてもアンラップできないようにする。
 */
export function dekWrapAad(tenantId: string): Buffer {
  return Buffer.from(`katahimo/dek/v2\0${tenantId}`, 'utf8');
}

/** AAD付きでラップした値の保存形式の接頭辞(それより前のAADなしの形式と見分けるため)。 */
export const WRAPPED_DEK_PREFIX = 'v2:';
