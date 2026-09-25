import type { ImportRunStatus, ImportSource } from '../domain/model';

export interface ImportRunRecord {
  id: string;
  source: ImportSource;
  fileName: string | null;
  fileVersion: string | null;
  status: ImportRunStatus;
  counts: Record<string, number>;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface ImportRunRepository {
  start(input: {
    id: string;
    source: ImportSource;
    fileName: string | null;
    fileVersion: string | null;
    triggeredBy: string | null;
  }): Promise<void>;
  finish(
    id: string,
    result: {
      status: Exclude<ImportRunStatus, 'running'>;
      counts: Record<string, number>;
      message: string | null;
    },
  ): Promise<void>;
  /** 最後に適用した(status = 'applied')取込。 */
  latestApplied(source: ImportSource): Promise<ImportRunRecord | null>;
}
