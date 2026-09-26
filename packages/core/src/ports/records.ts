import type { CareRecordStatus, CareRecordType, StoredFilePurpose } from '../domain/model';
import type { CareRecordContent } from '../domain/reports/careRecord';
import type { InstantRangeValue } from './attendance';

export interface CareRecordRow {
  id: string;
  recordType: CareRecordType;
  status: CareRecordStatus;
  visitId: string | null;
  customerId: string;
  careRecipientId: string | null;
  authorStaffId: string;
  occurredAt: Date;
  servicePeriod: InstantRangeValue | null;
  riskRating: number | null;
  esRating: number | null;
  body: CareRecordContent;
  bodySchemaVer: number;
  aiGenerated: boolean;
  retainUntil: string | null;
  rowVersion: number;
}

export type NewCareRecordInput = Omit<CareRecordRow, 'rowVersion'>;
export type CareRecordPatch = Partial<
  Pick<
    CareRecordRow,
    | 'recordType'
    | 'occurredAt'
    | 'servicePeriod'
    | 'riskRating'
    | 'esRating'
    | 'body'
    | 'bodySchemaVer'
    | 'aiGenerated'
    | 'status'
  >
>;

/** 並び (occurred_at DESC, id DESC) の中の位置(キーセットページング)。 */
export interface CareRecordCursor {
  occurredAt: Date;
  id: string;
}

export interface CareRecordRepository {
  findById(id: string): Promise<CareRecordRow | null>;
  insert(input: NewCareRecordInput): Promise<CareRecordRow>;
  /** expectedVersion を渡すと row_version が一致するときだけ更新(違えば conflict)。locked は locked。 */
  update(id: string, patch: CareRecordPatch, expectedVersion?: number): Promise<CareRecordRow>;
  /** 顧客の記録を新しい順に limit 件(after より後ろ)。 */
  listByCustomer(customerId: string, after: CareRecordCursor | null, limit: number): Promise<CareRecordRow[]>;
}

export interface StoredFileRow {
  id: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
  sha256: Uint8Array;
  purpose: StoredFilePurpose;
  createdBy: string | null;
}

export interface StoredFileRepository {
  insert(input: StoredFileRow): Promise<void>;
  findById(id: string): Promise<StoredFileRow | null>;
  /** どこからも参照されていない、olderThan より前のファイル(掃除ジョブ用)。 */
  listUnreferenced(olderThan: Date, limit: number): Promise<StoredFileRow[]>;
  delete(id: string): Promise<void>;
}

export interface ReceiptUploadRow {
  id: string;
  staffId: string;
  customerId: string | null;
  customerNameText: string | null;
  handoffText: string | null;
  createdBy: string;
}

export interface ReceiptRow {
  id: string;
  uploadId: string;
  fileId: string;
  staffId: string;
  customerId: string | null;
  customerNameText: string | null;
  receiptedAt: Date;
  amountYen: number | null;
  storeName: string | null;
  /** 重複判定のキーの SHA-256(domain/reports/receiptDedupe.ts)。判定しない領収書は null。 */
  dedupeHash: Uint8Array | null;
}

export interface ReceiptRepository {
  createUpload(input: ReceiptUploadRow): Promise<void>;
  findUpload(id: string): Promise<ReceiptUploadRow | null>;
  /**
   * 重複でなければ登録して true。同じ dedupe_hash の行が既にあれば(同時の登録を含め)何もせず false
   * (INSERT … ON CONFLICT DO NOTHING)。
   */
  insertIfNew(input: ReceiptRow): Promise<boolean>;
  findById(id: string): Promise<ReceiptRow | null>;
  /** その束で最初に登録した領収書か(申し送りを送る行を決める)。 */
  isFirstOfUpload(receipt: Pick<ReceiptRow, 'id' | 'uploadId'>): Promise<boolean>;
  /** スタッフの領収書のうち、領収書日時が [from, to) のもの。 */
  listByStaffAndPeriod(staffId: string, from: Date, to: Date): Promise<ReceiptRow[]>;
}
