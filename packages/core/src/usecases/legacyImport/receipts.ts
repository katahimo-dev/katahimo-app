import { createHash } from 'node:crypto';
import { RECEIPT_IMAGE_MAX_BYTES } from '@katahimo/shared';
import {
  buildReceiptDedupeKey,
  canCheckReceiptDuplicate,
  detectReceiptImageType,
  legacyReceiptKeyTimestamps,
  legacyWallClockToInstant,
  newId,
  normalizeText,
  RECEIPT_IMAGE_EXTENSIONS,
  type ReceiptImageType,
  receiptDedupeHash,
  yearMonthOf,
  zonedBusinessDate,
} from '../../domain';
import type { LegacyDriveFilePort, LegacyImportedRow } from '../../ports/legacyImport';
import type { StoragePort } from '../../ports/storage';
import type { TenantRepositories } from '../../ports/unitOfWork';
import { parseAmountYen } from '../receipts';
import {
  chunksOf,
  emptyCounts,
  finishFailed,
  flattenCounts,
  IssueLog,
  type LegacyImportCounts,
  type LegacyImportDeps,
  type LegacyImportOptions,
  loadStaffByName,
  resolveStaff,
  sameDigest,
  sortIssues,
  sourceDigestOf,
} from './common';
import type { LegacyReceiptRow, LegacyRowIssue, LegacyRowIssueReason, LegacySheetRows } from './types';

export interface LegacyReceiptImportDeps extends LegacyImportDeps {
  storage: StoragePort;
  drive: LegacyDriveFilePort;
}

export interface LegacyReceiptImportInput {
  /** 読んだスプレッドシートの ID(import_runs.file_name に残す)。 */
  spreadsheetId: string;
  sheet: LegacySheetRows<LegacyReceiptRow>;
  /** 取り込む月('YYYY-MM'。領収書日時のテナントのタイムゾーンでの月)。1つ以上。 */
  months: readonly string[];
}

export interface LegacyReceiptImportResult {
  dryRun: boolean;
  runId: string | null;
  counts: LegacyImportCounts;
  issues: LegacyRowIssue[];
}

/** 1つのトランザクションで書く領収書の数(画像はその前にまとめて読む)。 */
export const LEGACY_RECEIPT_BATCH_SIZE = 20;

/** Drive の MIME の種類のうち、取り込める画像(中身はバイト列でもう一度確かめる)。 */
const IMPORTABLE_MIME_TYPES = new Set<string>(Object.keys(RECEIPT_IMAGE_EXTENSIONS));

/** 取り込む行(担当・顧客を決めたもの)。 */
interface PlannedReceipt {
  row: LegacyReceiptRow;
  staffId: string;
  customerId: string | null;
  customerNameText: string | null;
  receiptedAt: Date;
  amountYen: number | null;
  storeName: string | null;
  handoffText: string | null;
  /** 重複の判定のキー(金額か店名が無ければ null)。取り込む領収書の dedupe_hash はこのキー。 */
  dedupeKey: string | null;
  /** 本アプリの登録と突き合わせるときにだけ見る、日時の形の違うキー(legacyReceiptKeyTimestamps)。 */
  alternativeDedupeKeys: string[];
  /** シートの行の値(読んだままの値。担当・顧客の探した結果は入れない)の SHA-256。 */
  digest: Uint8Array;
  /** 取り込むときの注意(取込済みの行には毎回は出さない)。 */
  warnings: LegacyRowIssueReason[];
}

/** 画像を読んで保存したもの。 */
interface StoredImage {
  fileId: string;
  storageKey: string;
  contentType: ReceiptImageType;
  bytes: Uint8Array;
}

/**
 * GAS版の「領収書一覧」の行を領収書に取り込む(移行の取込。`pnpm import:legacy-receipts`)。
 *
 * - 領収書日時(テナントのタイムゾーン)が months の月の行だけを取り込む(他の月は outOfRange に数えるだけ)。
 *   本アプリからのミラーの行(KatahimoReceiptId のある行)は読む側(ingestion)が除いている。
 * - 行を指すキーは画像の Drive のファイル ID(1枚ごとに違う)。legacy_imported_rows と突き合わせ、同じ画像は2回
 *   取り込まない(何度流してもよい)。領収書は会計の記録で直さないため、取込済みの行のシートの値が変わっていても
 *   直さずに changed_in_sheet(warning。変わっていない行と別に数える)にする。比べるのはシートの値だけで、後から顧客CSVを
 *   取り込んで顧客ID に合うお客様ができても、取込済みの領収書は結び付け直さず注意も出さない。まだ取り込んでいない
 *   画像の行の行番号で別の画像を取り込んでいれば(行を消した・並べ替えた)、取り込まない(row_conflict)。
 * - 画像は Drive から読み、画面からの登録と同じく中身のバイト列で JPEG・PNG・WebP か、1枚
 *   RECEIPT_IMAGE_MAX_BYTES までかを確かめてからファイル置き場に保存する(HEIC 等は取り込まない)。dry-run は Drive の
 *   メタデータ(種類・大きさ)だけを見る。
 * - 担当はスタッフの氏名(GAS版はユーザーID の列に氏名を書いた)、顧客は RESERVA の顧客ID で探す。担当が見つからない行は
 *   取り込まない。顧客ID が見つからない行は、顧客名を氏名として(顧客に結び付けずに)取り込む(customer_unlinked)。
 * - 1行を1回の登録(receipt_uploads)にし、申し送りはその行の申し送り(GAS版は登録の最初の1枚の行にだけ書いた)。
 *   会社負担ではない・取消していない領収書として作る。
 * - 画面の登録と同じ重複の判定(buildReceiptDedupeKey: 日時・担当・顧客・金額・店名)を掛ける: 本アプリで登録した
 *   取消していない同じ内容の領収書があれば取り込まない(duplicate)。日時は本アプリの登録と同じ分までの形でキーにし、
 *   秒つきの形の登録とも突き合わせる(legacyReceiptKeyTimestamps)。GAS版の同じ登録の中の同じ内容(往復の運賃等)は
 *   シートに全て残っているため、取り込んだ領収書と同じ内容の行は全て取り込む(代表でない行として)。
 * - スプレッドシートへのミラー・Google Chat の通知は積まない。
 */
export async function importLegacyReceiptRows(
  deps: LegacyReceiptImportDeps,
  tenantId: string,
  input: LegacyReceiptImportInput,
  options: LegacyImportOptions = {},
): Promise<LegacyReceiptImportResult> {
  if (input.months.length === 0) throw new Error('取り込む月を1つ以上指定してください');
  const dryRun = options.dryRun === true;
  const runId = newId();
  const counts = emptyCounts();
  const bySource = { gas_receipt: counts };
  const log = new IssueLog(bySource);
  const months = new Set(input.months);
  if (!dryRun) {
    await deps.uow.run(tenantId, (r) =>
      r.importRuns.start({
        id: runId,
        source: 'legacy_receipts_sheet',
        fileName: input.spreadsheetId,
        fileVersion: null,
        triggeredBy: null,
      }),
    );
  }
  try {
    for (const issue of input.sheet.issues) log.add(issue.source, issue.rowNumber, issue.reason);
    counts.blank = input.sheet.blankRowCount;
    const context = await deps.uow.run(tenantId, async (r) => ({
      timeZone: (await r.tenant()).timezone,
      staffByName: await loadStaffByName(r),
      customerByExternalId: await r.customerSourceRecords.mapExternalIds('reserva'),
    }));

    const planned: PlannedReceipt[] = [];
    for (const row of input.sheet.rows) {
      const receiptedAt = legacyWallClockToInstant(row.timestamp, context.timeZone);
      if (!months.has(yearMonthOf(zonedBusinessDate(receiptedAt, context.timeZone)))) {
        counts.outOfRange++;
        continue;
      }
      const staff = resolveStaff(context.staffByName, row.staffName);
      if ('reason' in staff) {
        log.add(row.source, row.rowNumber, staff.reason);
        continue;
      }
      const customerId = row.customerExternalId
        ? (context.customerByExternalId.get(row.customerExternalId)?.customerId ?? null)
        : null;
      const warnings: LegacyRowIssueReason[] = [];
      if (row.customerExternalId && !customerId) warnings.push('customer_unlinked');
      const amountYen = parseAmountYen(row.amount);
      if (row.amount && amountYen === null) warnings.push('amount_invalid');
      const keyInput = {
        staffId: staff.staffId,
        customerId: customerId ?? '',
        amount: row.amount,
        storeName: row.storeName,
      };
      const checkable = canCheckReceiptDuplicate({ amount: row.amount, storeName: row.storeName });
      const timestamps = legacyReceiptKeyTimestamps(row.timestamp);
      planned.push({
        row,
        staffId: staff.staffId,
        customerId,
        customerNameText: customerId ? null : normalizeText(row.customerName) || null,
        receiptedAt,
        amountYen,
        storeName: normalizeText(row.storeName) || null,
        handoffText: normalizeText(row.handoffText) || null,
        dedupeKey: checkable ? buildReceiptDedupeKey({ ...keyInput, timestamp: timestamps.canonical }) : null,
        alternativeDedupeKeys: checkable
          ? timestamps.alternatives.map((timestamp) => buildReceiptDedupeKey({ ...keyInput, timestamp }))
          : [],
        digest: sourceDigestOf({
          timestamp: row.timestamp,
          staffName: row.staffName,
          customerExternalId: row.customerExternalId,
          customerName: row.customerName,
          amount: row.amount,
          storeName: row.storeName,
          handoffText: row.handoffText,
        }),
        warnings,
      });
    }

    /** 重複の判定のキー → この取込での扱い(取り込んだ内容・本アプリの領収書と重複した内容)。 */
    const groups = new Map<string, 'imported' | 'duplicate'>();
    for (const batch of chunksOf(planned, LEGACY_RECEIPT_BATCH_SIZE)) {
      const links = await deps.uow.run(tenantId, (r) => findLinks(r, batch));
      const fresh: PlannedReceipt[] = [];
      for (const p of batch) {
        const link = links.byFile.get(p.row.sourceKey);
        if (link) {
          if (sameDigest(link.sourceDigest, p.digest)) counts.unchanged++;
          else log.add(p.row.source, p.row.rowNumber, 'changed_in_sheet');
          continue;
        }
        for (const reason of p.warnings) log.add(p.row.source, p.row.rowNumber, reason);
        if (links.byRow.has(p.row.rowNumber)) log.add(p.row.source, p.row.rowNumber, 'row_conflict');
        else fresh.push(p);
      }
      if (dryRun) {
        // Drive のメタデータはトランザクションの外で読む
        const readable: PlannedReceipt[] = [];
        for (const p of fresh) {
          const reason = imageProblemOf(await deps.drive.getFile(p.row.sourceKey));
          if (reason) log.add(p.row.source, p.row.rowNumber, reason);
          else readable.push(p);
        }
        await deps.uow.run(tenantId, async (r) => {
          for (const p of readable) {
            const decision = await dedupeDecision(r, p, groups);
            if (p.dedupeKey !== null)
              groups.set(p.dedupeKey, decision === 'duplicate' ? 'duplicate' : 'imported');
            if (decision === 'duplicate') {
              log.add(p.row.source, p.row.rowNumber, 'duplicate');
              continue;
            }
            counts.created++;
          }
        });
        continue;
      }
      await importBatch(deps, tenantId, runId, fresh, groups, log, counts);
    }
  } catch (error) {
    await finishFailed(
      deps,
      tenantId,
      { id: runId, dryRun, action: 'legacy_import.receipts.failed', counts: bySource },
      error,
    );
    throw error;
  }

  if (!dryRun) {
    await deps.uow.run(tenantId, (r) =>
      r.importRuns.finish(runId, {
        status: 'applied',
        counts: flattenCounts(bySource),
        message: `対象の月: ${[...months].sort().join(', ')}`,
      }),
    );
    await deps.appLog.write({
      tenantId,
      level: counts.errors > 0 ? 'WARN' : 'INFO',
      action: 'legacy_import.receipts.done',
      actorType: 'system',
      details: { runId, months: [...months].sort(), counts: flattenCounts(bySource) },
    });
  }
  return { dryRun, runId: dryRun ? null : runId, counts, issues: sortIssues(log.issues) };
}

/** 画像の Drive のファイル ID・行番号で探した対応。 */
interface ReceiptLinks {
  byFile: Map<string, LegacyImportedRow>;
  byRow: Map<number, LegacyImportedRow>;
}

async function findLinks(r: TenantRepositories, batch: readonly PlannedReceipt[]): Promise<ReceiptLinks> {
  const byFile = await r.legacyImports.findBySourceKeys(
    'gas_receipt',
    batch.map((p) => p.row.sourceKey),
  );
  const byRow = await r.legacyImports.findByRowNumbers(
    'gas_receipt',
    batch.map((p) => p.row.rowNumber),
  );
  return {
    byFile: new Map(byFile.map((link) => [link.sourceKey, link])),
    byRow: new Map(byRow.map((link) => [link.rowNumber, link])),
  };
}

/** Drive のメタデータで取り込めない画像か(取り込めれば null)。 */
function imageProblemOf(
  file: Awaited<ReturnType<LegacyDriveFilePort['getFile']>>,
): LegacyRowIssueReason | null {
  if (!file || file.trashed) return 'image_unavailable';
  if (!IMPORTABLE_MIME_TYPES.has(file.mimeType)) return 'image_unsupported_type';
  if (file.byteSize !== null && file.byteSize > RECEIPT_IMAGE_MAX_BYTES) return 'image_too_large';
  return null;
}

/**
 * 重複の判定: 代表(dedupe_primary)として登録するか、代表でない同じ内容の行として登録するか、本アプリの領収書と
 * 重複するか。この取込で既に同じ内容を取り込んだ(または重複と決めた)ならそれに従う。取消していない同じ内容の
 * 代表が GAS版から取り込んだ領収書なら、GAS版の同じ登録の中の同じ内容として代表でない行にする。
 */
async function dedupeDecision(
  r: TenantRepositories,
  p: PlannedReceipt,
  groups: Map<string, 'imported' | 'duplicate'>,
): Promise<'primary' | 'twin' | 'duplicate' | 'unchecked'> {
  if (p.dedupeKey === null) return 'unchecked';
  const group = groups.get(p.dedupeKey);
  if (group === 'duplicate') return 'duplicate';
  if (group === 'imported') return 'twin';
  for (const key of [p.dedupeKey, ...p.alternativeDedupeKeys]) {
    const activeId = await r.receipts.findActivePrimaryByDedupeHash(receiptDedupeHash(key));
    if (!activeId) continue;
    // 取込で作る領収書のキーは代表の形だけのため、他の形で見つかるのは本アプリの登録
    return key === p.dedupeKey && (await r.legacyImports.isImportedReceipt(activeId)) ? 'twin' : 'duplicate';
  }
  return 'primary';
}

/** 画像を読んで確かめ、ファイル置き場に保存する(取り込めない画像はその理由)。 */
async function fetchImage(
  deps: LegacyReceiptImportDeps,
  tenantId: string,
  p: PlannedReceipt,
): Promise<StoredImage | LegacyRowIssueReason> {
  const problem = imageProblemOf(await deps.drive.getFile(p.row.sourceKey));
  if (problem) return problem;
  let bytes: Uint8Array;
  try {
    bytes = await deps.drive.download(p.row.sourceKey);
  } catch {
    return 'image_unavailable';
  }
  if (bytes.length > RECEIPT_IMAGE_MAX_BYTES) return 'image_too_large';
  const contentType = detectReceiptImageType(bytes);
  if (!contentType) return 'image_unsupported_type';
  const fileId = newId();
  const storageKey = `${tenantId}/receipts/${fileId}.${RECEIPT_IMAGE_EXTENSIONS[contentType]}`;
  await deps.storage.put(storageKey, contentType, bytes);
  return { fileId, storageKey, contentType, bytes };
}

type BatchIssue = { p: PlannedReceipt; reason: LegacyRowIssueReason };

async function importBatch(
  deps: LegacyReceiptImportDeps,
  tenantId: string,
  runId: string,
  fresh: readonly PlannedReceipt[],
  groups: Map<string, 'imported' | 'duplicate'>,
  log: IssueLog,
  counts: LegacyImportCounts,
): Promise<void> {
  // 画像はトランザクションの外で読んで保存する(途中で失敗したら、このまとまりで保存した画像を全て消す)
  const ready: { p: PlannedReceipt; image: StoredImage }[] = [];
  const issues: BatchIssue[] = [];
  const unused: StoredImage[] = [];
  const nextGroups = new Map(groups);
  let created = 0;
  try {
    for (const p of fresh) {
      const image = await fetchImage(deps, tenantId, p);
      if (typeof image === 'string') issues.push({ p, reason: image });
      else ready.push({ p, image });
    }
    if (ready.length > 0) {
      const written = await deps.uow.run(tenantId, (r) => writeBatch(r, runId, ready, nextGroups, unused));
      created = written.created;
      issues.push(...written.issues);
    }
  } catch (error) {
    await Promise.all(ready.map(({ image }) => deps.storage.delete(image.storageKey).catch(() => undefined)));
    throw error;
  }
  await Promise.all(unused.map((image) => deps.storage.delete(image.storageKey).catch(() => undefined)));
  // トランザクションが確定してから、この取込での扱いを次のまとまりへ引き継ぐ
  for (const [key, value] of nextGroups) groups.set(key, value);
  for (const { p, reason } of issues) log.add(p.row.source, p.row.rowNumber, reason);
  counts.created += created;
}

/** 読んで保存した画像の領収書を1つのトランザクションで書く(使わなかった画像は unused に入れる)。 */
async function writeBatch(
  r: TenantRepositories,
  runId: string,
  ready: readonly { p: PlannedReceipt; image: StoredImage }[],
  groups: Map<string, 'imported' | 'duplicate'>,
  unused: StoredImage[],
): Promise<{ created: number; issues: BatchIssue[] }> {
  await r.legacyImports.lockTenantLegacyImports();
  // 読んでから書くまでの間に別の取込が同じ画像・行番号を取り込んでいたら、今回は作らない
  const links = await findLinks(
    r,
    ready.map(({ p }) => p),
  );
  const result: { created: number; issues: BatchIssue[] } = { created: 0, issues: [] };
  for (const { p, image } of ready) {
    if (links.byFile.has(p.row.sourceKey)) {
      unused.push(image);
      continue;
    }
    if (links.byRow.has(p.row.rowNumber)) {
      unused.push(image);
      result.issues.push({ p, reason: 'row_conflict' });
      continue;
    }
    const decision = await dedupeDecision(r, p, groups);
    if (decision === 'duplicate') {
      if (p.dedupeKey !== null) groups.set(p.dedupeKey, 'duplicate');
      unused.push(image);
      result.issues.push({ p, reason: 'duplicate' });
      continue;
    }
    const receiptId = newId();
    const uploadId = newId();
    await r.receipts.createUpload({
      id: uploadId,
      staffId: p.staffId,
      customerId: p.customerId,
      customerNameText: p.customerNameText,
      handoffText: p.handoffText,
      createdBy: p.staffId,
    });
    await r.storedFiles.insert({
      id: image.fileId,
      storageKey: image.storageKey,
      contentType: image.contentType,
      byteSize: image.bytes.length,
      sha256: createHash('sha256').update(image.bytes).digest(),
      purpose: 'receipt_image',
      createdBy: p.staffId,
    });
    const inserted = await r.receipts.insertIfNew({
      id: receiptId,
      uploadId,
      fileId: image.fileId,
      staffId: p.staffId,
      customerId: p.customerId,
      customerNameText: p.customerNameText,
      receiptedAt: p.receiptedAt,
      amountYen: p.amountYen,
      storeName: p.storeName,
      companyPaid: false,
      dedupeHash: p.dedupeKey === null ? null : receiptDedupeHash(p.dedupeKey),
      dedupePrimary: decision === 'primary',
    });
    if (!inserted) {
      // 判定の後に本アプリで同じ内容が登録された(登録の束は画像の無いまま残さない)
      throw new Error('領収書の重複の判定の後に同じ内容が登録されました。流し直してください');
    }
    if (p.dedupeKey !== null) groups.set(p.dedupeKey, 'imported');
    await r.legacyImports.save({
      source: 'gas_receipt',
      rowNumber: p.row.rowNumber,
      sourceKey: p.row.sourceKey,
      careRecordId: null,
      receiptId,
      sourceDigest: p.digest,
      // 領収書の版は登録したときの 1(領収書は取消のほかに変わらない)
      syncedRowVersion: 1,
      importRunId: runId,
    });
    result.created++;
  }
  return result;
}
