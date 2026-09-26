import { conflict, STALE_WRITE_MESSAGE } from '@katahimo/core/domain';
import type {
  CareRecordCursor,
  CareRecordListFilter,
  CareRecordListRow,
  CareRecordPatch,
  CareRecordRepository,
  CareRecordRow,
  NewCareRecordInput,
  ReceiptImageRef,
  ReceiptListFilter,
  ReceiptListPosition,
  ReceiptListRow,
  ReceiptListSummary,
  ReceiptRepository,
  ReceiptRow,
  ReceiptUploadRow,
  StoredFileRepository,
  StoredFileRow,
} from '@katahimo/core/ports';
import { and, asc, count, desc, eq, gte, inArray, lt, notExists, sql } from 'drizzle-orm';
import {
  careRecordRevisions,
  careRecords,
  customers,
  dataExportRequests,
  receipts,
  receiptUploads,
  staff,
  staffAttributes,
  storedFiles,
} from '../../schema';
import { TenantBound } from './base';

const careRecordColumns = {
  id: careRecords.id,
  recordType: careRecords.recordType,
  status: careRecords.status,
  visitId: careRecords.visitId,
  customerId: careRecords.customerId,
  careRecipientId: careRecords.careRecipientId,
  authorStaffId: careRecords.authorStaffId,
  occurredAt: careRecords.occurredAt,
  servicePeriod: careRecords.servicePeriod,
  riskRating: careRecords.riskRating,
  esRating: careRecords.esRating,
  body: careRecords.body,
  bodySchemaVer: careRecords.bodySchemaVer,
  aiGenerated: careRecords.aiGenerated,
  retainUntil: careRecords.retainUntil,
  rowVersion: careRecords.rowVersion,
};

const careRecordListColumns = { ...careRecordColumns, updatedAt: careRecords.updatedAt };

/** 並び (occurred_at DESC, id DESC) で after より後ろ(行の比較。索引の範囲で読める)。 */
function afterCursor(after: CareRecordCursor | null) {
  return after
    ? sql`(${careRecords.occurredAt}, ${careRecords.id}) < (${after.occurredAt.toISOString()}::timestamptz, ${after.id}::uuid)`
    : undefined;
}

export class DrizzleCareRecordRepository extends TenantBound implements CareRecordRepository {
  async findById(id: string): Promise<CareRecordRow | null> {
    const rows = await this.tx
      .select(careRecordColumns)
      .from(careRecords)
      .where(and(eq(careRecords.tenantId, this.tenantId), eq(careRecords.id, id)));
    return rows[0] ?? null;
  }

  async insert(input: NewCareRecordInput): Promise<CareRecordRow> {
    const [row] = await this.tx
      .insert(careRecords)
      .values({ tenantId: this.tenantId, ...input })
      .returning(careRecordColumns);
    return row as CareRecordRow;
  }

  async update(id: string, patch: CareRecordPatch, expectedVersion?: number): Promise<CareRecordRow> {
    const rows = await this.tx
      .update(careRecords)
      .set({ ...patch, rowVersion: sql`${careRecords.rowVersion} + 1` })
      .where(
        and(
          eq(careRecords.tenantId, this.tenantId),
          eq(careRecords.id, id),
          expectedVersion === undefined ? undefined : eq(careRecords.rowVersion, expectedVersion),
        ),
      )
      .returning(careRecordColumns);
    if (!rows[0]) throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
    return rows[0];
  }

  listByCustomer(
    customerId: string,
    after: CareRecordCursor | null,
    limit: number,
  ): Promise<CareRecordRow[]> {
    return this.tx
      .select(careRecordColumns)
      .from(careRecords)
      .where(
        and(
          eq(careRecords.tenantId, this.tenantId),
          eq(careRecords.customerId, customerId),
          // 行の比較にすると (tenant_id, customer_id, occurred_at DESC, id DESC) の索引の範囲で読める
          afterCursor(after),
        ),
      )
      .orderBy(desc(careRecords.occurredAt), desc(careRecords.id))
      .limit(limit);
  }

  listByPeriod(
    filter: CareRecordListFilter,
    after: CareRecordCursor | null,
    limit: number,
  ): Promise<CareRecordListRow[]> {
    return this.tx
      .select(careRecordListColumns)
      .from(careRecords)
      .where(
        and(
          eq(careRecords.tenantId, this.tenantId),
          gte(careRecords.occurredAt, filter.from),
          lt(careRecords.occurredAt, filter.to),
          filter.authorStaffId ? eq(careRecords.authorStaffId, filter.authorStaffId) : undefined,
          filter.customerId ? eq(careRecords.customerId, filter.customerId) : undefined,
          filter.recordTypes ? inArray(careRecords.recordType, [...filter.recordTypes]) : undefined,
          afterCursor(after),
        ),
      )
      .orderBy(desc(careRecords.occurredAt), desc(careRecords.id))
      .limit(limit);
  }

  async findListRowById(id: string): Promise<CareRecordListRow | null> {
    const rows = await this.tx
      .select(careRecordListColumns)
      .from(careRecords)
      .where(and(eq(careRecords.tenantId, this.tenantId), eq(careRecords.id, id)));
    return rows[0] ?? null;
  }

  async countRevisions(id: string): Promise<number> {
    const [row] = await this.tx
      .select({ n: count() })
      .from(careRecordRevisions)
      .where(and(eq(careRecordRevisions.tenantId, this.tenantId), eq(careRecordRevisions.careRecordId, id)));
    return row?.n ?? 0;
  }
}

const fileColumns = {
  id: storedFiles.id,
  storageKey: storedFiles.storageKey,
  contentType: storedFiles.contentType,
  byteSize: storedFiles.byteSize,
  sha256: storedFiles.sha256,
  purpose: storedFiles.purpose,
  createdBy: storedFiles.createdBy,
};

export class DrizzleStoredFileRepository extends TenantBound implements StoredFileRepository {
  async insert(input: StoredFileRow): Promise<void> {
    await this.tx.insert(storedFiles).values({ tenantId: this.tenantId, ...input });
  }

  async findById(id: string): Promise<StoredFileRow | null> {
    const rows = await this.tx
      .select(fileColumns)
      .from(storedFiles)
      .where(and(eq(storedFiles.tenantId, this.tenantId), eq(storedFiles.id, id)));
    return rows[0] ?? null;
  }

  listUnreferenced(olderThan: Date, limit: number): Promise<StoredFileRow[]> {
    const one = { one: sql`1` };
    return this.tx
      .select(fileColumns)
      .from(storedFiles)
      .where(
        and(
          eq(storedFiles.tenantId, this.tenantId),
          lt(storedFiles.createdAt, olderThan),
          notExists(
            this.tx
              .select(one)
              .from(receipts)
              .where(and(eq(receipts.tenantId, storedFiles.tenantId), eq(receipts.fileId, storedFiles.id))),
          ),
          notExists(
            this.tx
              .select(one)
              .from(staffAttributes)
              .where(
                and(
                  eq(staffAttributes.tenantId, storedFiles.tenantId),
                  eq(staffAttributes.evidenceFileId, storedFiles.id),
                ),
              ),
          ),
          notExists(
            this.tx
              .select(one)
              .from(dataExportRequests)
              .where(
                and(
                  eq(dataExportRequests.tenantId, storedFiles.tenantId),
                  eq(dataExportRequests.fileId, storedFiles.id),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(storedFiles.createdAt))
      .limit(limit);
  }

  async delete(id: string): Promise<void> {
    await this.tx
      .delete(storedFiles)
      .where(and(eq(storedFiles.tenantId, this.tenantId), eq(storedFiles.id, id)));
  }
}

const receiptColumns = {
  id: receipts.id,
  uploadId: receipts.uploadId,
  fileId: receipts.fileId,
  staffId: receipts.staffId,
  customerId: receipts.customerId,
  customerNameText: receipts.customerNameText,
  receiptedAt: receipts.receiptedAt,
  amountYen: receipts.amountYen,
  storeName: receipts.storeName,
  dedupeHash: receipts.dedupeHash,
};

export class DrizzleReceiptRepository extends TenantBound implements ReceiptRepository {
  async createUpload(input: ReceiptUploadRow): Promise<void> {
    await this.tx.insert(receiptUploads).values({ tenantId: this.tenantId, ...input });
  }

  async findUpload(id: string): Promise<ReceiptUploadRow | null> {
    const rows = await this.tx
      .select({
        id: receiptUploads.id,
        staffId: receiptUploads.staffId,
        customerId: receiptUploads.customerId,
        customerNameText: receiptUploads.customerNameText,
        handoffText: receiptUploads.handoffText,
        createdBy: receiptUploads.createdBy,
      })
      .from(receiptUploads)
      .where(and(eq(receiptUploads.tenantId, this.tenantId), eq(receiptUploads.id, id)));
    return rows[0] ?? null;
  }

  async insertIfNew(input: ReceiptRow): Promise<boolean> {
    const rows = await this.tx
      .insert(receipts)
      .values({ tenantId: this.tenantId, ...input })
      .onConflictDoNothing({
        target: [receipts.tenantId, receipts.dedupeHash],
        where: sql`dedupe_hash is not null`,
      })
      .returning({ id: receipts.id });
    return rows.length > 0;
  }

  async findById(id: string): Promise<ReceiptRow | null> {
    const rows = await this.tx
      .select(receiptColumns)
      .from(receipts)
      .where(and(eq(receipts.tenantId, this.tenantId), eq(receipts.id, id)));
    return rows[0] ?? null;
  }

  async isFirstOfUpload(receipt: Pick<ReceiptRow, 'id' | 'uploadId'>): Promise<boolean> {
    const [first] = await this.tx
      .select({ id: receipts.id })
      .from(receipts)
      .where(and(eq(receipts.tenantId, this.tenantId), eq(receipts.uploadId, receipt.uploadId)))
      .orderBy(asc(receipts.id))
      .limit(1);
    return first?.id === receipt.id;
  }

  listByStaffAndPeriod(staffId: string, from: Date, to: Date): Promise<ReceiptRow[]> {
    return this.tx
      .select(receiptColumns)
      .from(receipts)
      .where(
        and(
          eq(receipts.tenantId, this.tenantId),
          eq(receipts.staffId, staffId),
          gte(receipts.receiptedAt, from),
          lt(receipts.receiptedAt, to),
        ),
      )
      .orderBy(asc(receipts.receiptedAt));
  }

  /** 一覧・合計の共通の条件(テナント・期間・スタッフ・お客様)。 */
  private listConditions(filter: ReceiptListFilter) {
    return and(
      eq(receipts.tenantId, this.tenantId),
      gte(receipts.receiptedAt, filter.from),
      lt(receipts.receiptedAt, filter.to),
      filter.staffId === undefined ? undefined : eq(receipts.staffId, filter.staffId),
      filter.customerId === undefined ? undefined : eq(receipts.customerId, filter.customerId),
    );
  }

  list(
    filter: ReceiptListFilter,
    after: ReceiptListPosition | null,
    limit: number,
  ): Promise<ReceiptListRow[]> {
    return this.tx
      .select({
        id: receipts.id,
        uploadId: receipts.uploadId,
        staffId: receipts.staffId,
        staffName: staff.displayName,
        customerId: receipts.customerId,
        customerDisplayName: customers.displayName,
        customerNameText: receipts.customerNameText,
        receiptedAt: receipts.receiptedAt,
        amountYen: receipts.amountYen,
        storeName: receipts.storeName,
        handoffText: receiptUploads.handoffText,
        contentType: storedFiles.contentType,
        byteSize: storedFiles.byteSize,
      })
      .from(receipts)
      .innerJoin(
        receiptUploads,
        and(eq(receiptUploads.tenantId, receipts.tenantId), eq(receiptUploads.id, receipts.uploadId)),
      )
      .innerJoin(
        storedFiles,
        and(eq(storedFiles.tenantId, receipts.tenantId), eq(storedFiles.id, receipts.fileId)),
      )
      .leftJoin(staff, and(eq(staff.tenantId, receipts.tenantId), eq(staff.id, receipts.staffId)))
      .leftJoin(
        customers,
        and(eq(customers.tenantId, receipts.tenantId), eq(customers.id, receipts.customerId)),
      )
      .where(
        and(
          this.listConditions(filter),
          after
            ? sql`(${receipts.receiptedAt}, ${receipts.id}) < (${after.receiptedAt.toISOString()}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(receipts.receiptedAt), desc(receipts.id))
      .limit(limit);
  }

  async summarize(filter: ReceiptListFilter): Promise<ReceiptListSummary> {
    const [row] = await this.tx
      .select({
        count: sql<number>`count(*)::int`,
        totalYen: sql<number>`coalesce(sum(${receipts.amountYen}), 0)::bigint`,
        noAmountCount: sql<number>`count(*) filter (where ${receipts.amountYen} is null)::int`,
      })
      .from(receipts)
      .where(this.listConditions(filter));
    return {
      count: Number(row?.count ?? 0),
      totalYen: Number(row?.totalYen ?? 0),
      noAmountCount: Number(row?.noAmountCount ?? 0),
    };
  }

  async findImage(receiptId: string): Promise<ReceiptImageRef | null> {
    const rows = await this.tx
      .select({
        receiptId: receipts.id,
        staffId: receipts.staffId,
        storageKey: storedFiles.storageKey,
        contentType: storedFiles.contentType,
      })
      .from(receipts)
      .innerJoin(
        storedFiles,
        and(eq(storedFiles.tenantId, receipts.tenantId), eq(storedFiles.id, receipts.fileId)),
      )
      .where(and(eq(receipts.tenantId, this.tenantId), eq(receipts.id, receiptId)));
    return rows[0] ?? null;
  }
}
