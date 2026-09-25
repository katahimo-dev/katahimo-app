import { attendanceShots } from './attendance';
import { customerShots } from './customers';
import { foundationShots } from './foundation';
import { reportShots } from './report';
import { scheduleShots } from './schedule';
import type { Shot } from './types';

/**
 * 撮影する場面の一覧。機能ごとにファイルを分け、担当ごとに自分のファイルだけを編集する
 * (同じファイルを同時に編集しないように)。新しいファイルを作ったらここに1行足す。
 */
export const allShots: Shot[] = [
  ...foundationShots,
  ...scheduleShots,
  ...customerShots,
  ...attendanceShots,
  ...reportShots,
];
