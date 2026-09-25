// @katahimo/core の ports インターフェースの具体実装を置く層。
// このパッケージだけが googleapis / Google Maps Platform / Gemini に依存する。
// 予定・ルート計算は google-schedule(Google Calendar API + Google Maps Platform を直接呼ぶ)と
// gas-bridge(GAS版Web Appに委ねる移行期の実装)を schedule-provider で切り替える。
export * from './audit';
export * from './cache';
export * from './gas-bridge';
export * from './gemini';
export * from './google-calendar';
export * from './google-chat';
export * from './google-maps';
export * from './google-schedule';
export * from './local-crypto';
export * from './local-kms';
export * from './local-storage';
export * from './mail';
export * from './mirror';
export * from './noop';
export * from './schedule-provider';
