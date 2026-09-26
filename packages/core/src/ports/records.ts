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
    | 'careRecipientId'
    | 'riskRating'
    | 'esRating'
    | 'body'
    | 'bodySchemaVer'
    | 'status'
  >
>;

/** 並び (occurred_at DESC, id DESC) の中の位置(キーセットページング)。 */
export interface CareRecordCursor {
  occurredAt: Date;
  id: string;
}

/** 期間・スタッフ・お客様・種類での記録の絞り込み(全員分の一覧・CSV)。 */
export interface CareRecordListFilter {
  /** occurred_at が [from, to) のもの。 */
  from: Date;
  to: Date;
  authorStaffId?: string | undefined;
  customerId?: string | undefined;
  /** 省略はすべての種類。 */
  recordTypes?: readonly CareRecordType[] | undefined;
}

/** 一覧・詳細で読む記録(最後に保存された日時つき)。 */
export interface CareRecordListRow extends CareRecordRow {
  updatedAt: Date;
}

export interface CareRecordRepository {
  findById(id: string): Promise<CareRecordRow | null>;
  insert(input: NewCareRecordInput): Promise<CareRecordRow>;
  /** expectedVersion を渡すと row_version が一致するときだけ更新(違えば conflict)。locked は locked。 */
  update(id: string, patch: CareRecordPatch, expectedVersion?: number): Promise<CareRecordRow>;
  /** 顧客の記録を新しい順に limit 件(after より後ろ)。 */
  listByCustomer(customerId: string, after: CareRecordCursor | null, limit: number): Promise<CareRecordRow[]>;
  /** 条件に合う記録を (occurred_at DESC, id DESC) の順に limit 件(after より後ろ)。 */
  listByPeriod(
    filter: CareRecordListFilter,
    after: CareRecordCursor | null,
    limit: number,
  ): Promise<CareRecordListRow[]>;
  /** 1件を最後に保存された日時つきで読む。 */
  findListRowById(id: string): Promise<CareRecordListRow | null>;
  /** 保存し直された回数(care_record_revisions の件数)。 */
  countRevisions(id: string): Promise<number>;
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

/** 領収書の一覧の条件。領収書日時が [from, to)。staffId が無ければ全スタッフ。 */
export interface ReceiptListFilter {
  from: Date;
  to: Date;
  staffId?: string | undefined;
  customerId?: string | undefined;
}

/** 並び (receipted_at DESC, id DESC) の中の位置(キーセットページング)。 */
export interface ReceiptListPosition {
  receiptedAt: Date;
  id: string;
}

/** 一覧の1行(スタッフ・お客様の名前、束の申し送り、画像のメタデータを付けたもの)。 */
export interface ReceiptListRow {
  id: string;
  uploadId: string;
  staffId: string;
  /** 担当スタッフの氏名(スタッフの行が無ければ null)。 */
  staffName: string | null;
  customerId: string | null;
  /** 登録済みのお客様の表示名(customerId が無ければ null)。 */
  customerDisplayName: string | null;
  customerNameText: string | null;
  receiptedAt: Date;
  amountYen: number | null;
  storeName: string | null;
  handoffText: string | null;
  contentType: string;
  byteSize: number;
}

export interface ReceiptListSummary {
  count: number;
  /** 金額の合計(円。金額の無い領収書は0円)。 */
  totalYen: number;
  noAmountCount: number;
}

/** 画像を返すのに要るもの(担当スタッフで閲覧の可否を決める)。 */
export interface ReceiptImageRef {
  receiptId: string;
  staffId: string;
  storageKey: string;
  contentType: string;
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
  /** 一覧(領収書日時の新しい順、after より後ろを limit 件)。 */
  list(
    filter: ReceiptListFilter,
    after: ReceiptListPosition | null,
    limit: number,
  ): Promise<ReceiptListRow[]>;
  /** 条件に合う全件の件数・金額の合計。 */
  summarize(filter: ReceiptListFilter): Promise<ReceiptListSummary>;
  /** 領収書の画像の保存先(領収書が無ければ null)。 */
  findImage(receiptId: string): Promise<ReceiptImageRef | null>;
}
