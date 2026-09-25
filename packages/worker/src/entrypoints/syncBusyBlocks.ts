import { runOneShot } from '../jobs/runOneShot';
import { runSyncBusyBlocksJob } from '../jobs/syncBusyBlocks';

// pnpm --filter @katahimo/worker job:sync-busy-blocks
runOneShot('sync-busy-blocks', (container, env) =>
  runSyncBusyBlocksJob(container, { days: env.BUSY_BLOCK_SYNC_DAYS }),
);
