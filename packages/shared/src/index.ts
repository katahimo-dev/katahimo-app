// API契約(リクエスト/レスポンスのzodスキーマと型)と、サーバー・ブラウザ双方で使う既定値の入口。
// ここには「サーバーとブラウザの両方で成立するもの」だけを置く。
// Node固有・DB固有のものは @katahimo/core / @katahimo/db 側に置くこと。

export * from './contracts/attendance';
export * from './contracts/auditLogs';
export * from './contracts/auth';
export * from './contracts/calendarSync';
export * from './contracts/common';
export * from './contracts/customerHistory';
export * from './contracts/customerImport';
export * from './contracts/customers';
export * from './contracts/integrations';
export * from './contracts/push';
export * from './contracts/receipts';
export * from './contracts/reportAi';
export * from './contracts/reportList';
export * from './contracts/reports';
export * from './contracts/roles';
export * from './contracts/schedule';
export * from './contracts/settings';
export * from './contracts/staffAdmin';
export * from './contracts/uiConfig';
export * from './defaults/aiPrompts';
export * from './defaults/assessments';
export * from './defaults/passwordPolicy';
export * from './geo/latLng';
