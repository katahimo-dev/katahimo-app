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
  /**
   * このテナントの顧客の取込(顧客CSV・外部連携の API・開発用の初期データ)をトランザクションの終わりまで1つずつにする
   * (テナントごとのアドバイザリロック)。取込元の ID で突き合わせてから作るため、同時に走ると同じ顧客を2人作ったり、
   * 取込元の ID の一意制約でトランザクション全体が失敗したりする。取込の最初に呼ぶ。
   */
  lockTenantCustomerImports(): Promise<void>;
  /** 最後に適用した(status = 'applied')取込。 */
  latestApplied(source: ImportSource): Promise<ImportRunRecord | null>;
}
