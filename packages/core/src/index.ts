// ドメイン層の入口。
//
// 重要な制約: このパッケージは googleapis / drizzle / hono など具体的な外部SDKを
// 一切 import しない。外部システムとのやり取りは全て ./ports のインターフェース越しに行う。
// 「将来スプレッドシートをやめる」ときに書き換えるのは ports の実装(@katahimo/integrations)だけで、
// この層は無変更で済む、という境界を守るためのルール。
export * from './domain';
export * from './ports';
export * from './usecases';
