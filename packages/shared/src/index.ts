// API契約(リクエスト/レスポンスのzodスキーマと型)を api / web の両方から参照するための入口。
// ここには「サーバーとブラウザの両方で成立するもの」だけを置く。
// Node固有・DB固有のものは @katahimo/core / @katahimo/db 側に置くこと。

export * from './contracts/auth';
export * from './contracts/common';
