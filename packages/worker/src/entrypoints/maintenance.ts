import { runMaintenanceJob } from '../jobs/maintenance';
import { runOneShot } from '../jobs/runOneShot';

// pnpm --filter @katahimo/worker job:maintenance
runOneShot('maintenance', (container, _env, stop) => runMaintenanceJob(container, stop));
