// @katahimo/core の ports インターフェースの具体実装を置く層。
// このパッケージだけが googleapis / Google Maps Platform / Gemini に依存する。
// 予定・ルート計算は google-schedule(Google Calendar API + Google Maps Platform を直接呼ぶ)と
// gas-bridge(GAS版Web Appに委ねる移行期の実装)を schedule-provider で切り替える。
// ファイル保存(local-storage / gcs-storage)も同様に storage-provider で開発用と本番(GCS)の実装を切り替える。
// テナントの秘密値の封(secret-box)は開発用のローカル鍵と本番の Cloud KMS を切り替える。
// cloud-run は outbox を処理するジョブ(outbox-drain)の起動の依頼(Cloud Run Admin API)。
// legacy-sheets は GAS版のスプレッドシート・Drive からの移行の取込(読むだけ)。
export * from './cache';
export * from './cloud-run';
export * from './customer-csv';
export * from './gas-bridge';
export * from './gcs-storage';
export * from './gemini';
export * from './google-calendar';
export * from './google-chat';
export * from './google-maps';
export * from './google-schedule';
export * from './legacy-sheets';
export * from './local-storage';
export * from './mail';
export * from './noop';
export * from './runtime-env';
export * from './schedule-provider';
export * from './secret-box';
export * from './storage-provider';
export * from './web-push';
