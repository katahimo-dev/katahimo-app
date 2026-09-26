import { randomBytes } from 'node:crypto';

/**
 * UUIDv7(RFC 9562)を生成する。先頭48ビットがミリ秒単位のUNIX時刻のため、主キーの索引が挿入順に並び
 * (B-treeの断片化が少ない)、作成順の並び替えにも使える。
 *
 * PostgreSQL 18 の uuidv7() は本番(Cloud SQL 17)で使えないため、アプリ側で採番する。DB側の既定値は
 * gen_random_uuid()(v4)で、アプリを通さずに挿入した行の予備に留める。
 *
 * 同じミリ秒の中で呼ばれた場合も順序が保たれるよう、rand_a(12ビット)を単調増加のカウンタとして使う
 * (RFC 9562 6.2 の方式1)。カウンタが溢れたら時刻を1ミリ秒進める。
 */
let lastMs = 0;
let counter = 0;

export function uuidv7(now: number = Date.now()): string {
  let ms = now;
  if (ms <= lastMs) {
    counter++;
    if (counter > 0xfff) {
      lastMs++;
      counter = 0;
    }
    ms = lastMs;
  } else {
    lastMs = ms;
    counter = randomBytes(2).readUInt16BE(0) & 0x7ff;
  }
  const bytes = randomBytes(16);
  bytes.writeUIntBE(ms, 0, 6);
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 新しい行のID。テーブルの主キーは全てこれで採番する(INSERT 前に決め、子の行・outbox に同じトランザクションで使う)。 */
export const newId = (): string => uuidv7();
