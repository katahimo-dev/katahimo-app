// drizzle-kit が差分を取る対象(0000_baseline.sql)。app_logs はパーティション表のため手書きの SQL
// (0001_baseline_custom.sql)で作り、型の定義は ../customTables/appLogs.ts に置く(ここからは export しない)。
export * from './_types';
export * from './attendance';
export * from './customers';
export * from './lifecycle';
export * from './matching';
export * from './outbox';
export * from './platform';
export * from './records';
export * from './services';
export * from './staff';
export * from './tenancy';
