import { runRouteNoticeJob } from '../jobs/routeNotice';
import { runOneShot } from '../jobs/runOneShot';

// pnpm --filter @katahimo/worker job:route-notice [-- YYYY-MM-DD]
// 日付を省略するとテナントのタイムゾーンの明日。送り損ねた日を後から流し直すときだけ日付を指定する。
const date = process.argv.slice(2).find((arg) => /^\d{4}-\d{2}-\d{2}$/.test(arg));
runOneShot('route-notice', (container, _env, stop) => runRouteNoticeJob(container, { date, stop }));
