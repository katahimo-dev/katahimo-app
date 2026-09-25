// @katahimo/core の ports インターフェースの具体実装を置く層。
// このパッケージだけが googleapis / Google Maps Platform / Gemini に依存する。
// Phase 5 で google-sheets / google-drive / google-calendar / gemini を追加する
// (google-chatは実装済み。google-mapsはGoogle Maps Platformの新規契約を避けるため、
// gas-bridge/がGAS版Web Appをプロキシとして使う形で代替している)。
export * from './audit';
export * from './gas-bridge';
export * from './gemini';
export * from './google-chat';
export * from './local-crypto';
export * from './local-kms';
export * from './local-storage';
export * from './mirror';
