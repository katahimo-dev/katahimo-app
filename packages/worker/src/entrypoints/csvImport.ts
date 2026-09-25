import { runCsvImportJob } from '../jobs/csvImport';
import { runOneShot } from '../jobs/runOneShot';

// pnpm --filter @katahimo/worker job:csv-import
runOneShot('csv-import', (container) => runCsvImportJob(container));
