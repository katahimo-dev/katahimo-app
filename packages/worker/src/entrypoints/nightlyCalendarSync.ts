import { runNightlyCalendarSyncJob } from '../jobs/nightlyCalendarSync';
import { runOneShot } from '../jobs/runOneShot';

// pnpm --filter @katahimo/worker job:nightly-calendar-sync [-- YYYY-MM-DD]
// 日付を省略するとテナントのタイムゾーンの今日。取りこぼした日を後から流し直すときだけ日付を指定する。
const date = process.argv.slice(2).find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
runOneShot('nightly-calendar-sync', (container, _env, stop) =>
  runNightlyCalendarSyncJob(container, { date, stop }),
);
