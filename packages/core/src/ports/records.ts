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

/** 登録する領収書1枚。 */
export interface NewReceiptInput {
  id: string;
  uploadId: string;
  fileId: string;
  staffId: string;
  customerId: string | null;
  customerNameText: string | null;
  receiptedAt: Date;
  amountYen: number | null;
  storeName: string | null;
  /** 会社負担(お客様に請求しない)。登録の後は変えない。 */
  companyPaid: boolean;
  /**
   * 重複判定のキーの SHA-256(domain/reports/receiptDedupe.ts)。判定しない領収書は null。同じ登録の中の同じ内容の
   * 画像は全て同じ値を持つ。
   */
  dedupeHash: Uint8Array | null;
  /**
   * 同じ dedupeHash の取消していない行の代表(部分UNIQUE の対象。束の最初の1枚)。代表でない行は重複の判定をせずに
   * 登録する(同じ登録の中の同じ内容)。
   */
  dedupePrimary: boolean;
}

/** 領収書の取消(論理削除)の状態。取消していなければ全て null。 */
export interface ReceiptCancellation {
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
}

export interface ReceiptRow extends NewReceiptInput, ReceiptCancellation {
  rowVersion: number;
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

/** 一覧の1行(スタッフ・お客様の名前、束の申し送り、画像のメタデータ、取消の状態を付けたもの)。 */
export interface ReceiptListRow extends ReceiptCancellation {
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
  companyPaid: boolean;
  handoffText: string | null;
  contentType: string;
  byteSize: number;
  /** 取消したスタッフの氏名(取消していない・スタッフの行が無ければ null)。 */
  cancelledByName: string | null;
  rowVersion: number;
}

/** 条件に合う取消していない領収書の件数・合計と、取消済みの件数。 */
export interface ReceiptListSummary {
  count: number;
  /** 金額の合計(円。金額の無い領収書は0円。会社負担を含む)。 */
  totalYen: number;
  /** うち会社負担の合計(円)。 */
  companyPaidYen: number;
  noAmountCount: number;
  /** 取消済みの件数(合計には入れない)。 */
  cancelledCount: number;
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
   * 重複でなければ登録して true。代表(dedupePrimary)の行は、取消していない代表に同じ dedupe_hash があれば
   * (同時の登録を含め)何もせず false(INSERT … ON CONFLICT DO NOTHING)。代表でない行はそのまま登録する。
   */
  insertIfNew(input: NewReceiptInput): Promise<boolean>;
  findById(id: string): Promise<ReceiptRow | null>;
  /** その束で最初に登録した領収書か(申し送りを送る行を決める)。 */
  isFirstOfUpload(receipt: Pick<ReceiptRow, 'id' | 'uploadId'>): Promise<boolean>;
  /** スタッフの取消していない領収書のうち、領収書日時が [from, to) のもの(領収書日時の順)。 */
  listActiveByStaffAndPeriod(staffId: string, from: Date, to: Date): Promise<ReceiptRow[]>;
  /**
   * 一覧(領収書日時の新しい順、after より後ろを limit 件)。includeCancelled が false なら取消済みを除く
   * (画面の一覧は取消済みも灰色で出し、CSV は除く)。
   */
  list(
    filter: ReceiptListFilter & { includeCancelled: boolean },
    after: ReceiptListPosition | null,
    limit: number,
  ): Promise<ReceiptListRow[]>;
  /** 一覧の1行(取消の応答用。無ければ null)。 */
  findListRow(id: string): Promise<ReceiptListRow | null>;
  /** 条件に合う取消していない領収書の件数・金額の合計と、取消済みの件数。 */
  summarize(filter: ReceiptListFilter): Promise<ReceiptListSummary>;
  /** 領収書の画像の保存先(領収書が無ければ null)。 */
  findImage(receiptId: string): Promise<ReceiptImageRef | null>;
  /**
   * 取消す(取消の列を入れ、row_version を上げる)。取消していない行で row_version が expectedVersion の
   * ときだけ書き、それ以外(先に取消された・更新された)は conflict。取消した行が重複の判定の代表なら、同じ
   * dedupe_hash の取消していない行のうち最も古いもの(領収書日時・ID の順)を代表にする(同じトランザクション。
   * 同じ内容の行の取消は同時に進まないように、先に同じ内容の行をまとめてロックする)。代表を移した行の
   * row_version は上げない(画面の版は変わらない)。
   */
  cancel(
    id: string,
    cancellation: { cancelledAt: Date; cancelledBy: string; cancelReason: string | null },
    expectedVersion: number,
  ): Promise<void>;
}
