/**
 * DEK のラップに結び付ける追加認証データ(AAD)。LocalKmsPort・CloudKmsPort で共通。
 * テナントIDを含め、あるテナントの wrapped_dek を別のテナントの行にコピーしてもアンラップできないようにする。
 */
export function dekWrapAad(tenantId: string): Buffer {
  return Buffer.from(`katahimo/dek/v3\0${tenantId}`, 'utf8');
}
