import { z } from 'zod';
import { businessDateSchema, idSchema } from './common';

/**
 * 全員分の日報・事故報告の一覧と CSV(コーディネーター・管理者向け。スプレッドシートのミラーの置き換え)。
 * 種類は care_records.record_type と同じ(日報 / 事故報告 / ヒヤリハット)。
 */
export const REPORT_KINDS = ['daily_report', 'accident', 'near_miss'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const reportKindSchema = z.enum(REPORT_KINDS);

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  daily_report: '日報',
  accident: '事故報告',
  near_miss: 'ヒヤリハット',
};

/**
 * CSV の形(GAS版のスプレッドシートのどのシートと同じ列にするか)。
 * - daily: 「日報」シート(日報だけ)
 * - accident: 「事故報告」シート(事故報告とヒヤリハット。種別の列で分かる)
 */
export const REPORT_CSV_SHEETS = ['daily', 'accident'] as const;
export type ReportCsvSheet = (typeof REPORT_CSV_SHEETS)[number];

/** 期間を指定しないときに見る日数(今日を含む)。 */
export const REPORT_LIST_DEFAULT_RANGE_DAYS = 31;
/** 1回に指定できる期間の上限(日数。今日を含む。1年分の書き出しができるように366日)。 */
export const REPORT_LIST_MAX_RANGE_DAYS = 366;
/** 1ページの件数の上限。 */
export const REPORT_LIST_MAX_PAGE_SIZE = 100;
/** 一覧の抜粋の最大の文字数。 */
export const REPORT_EXCERPT_MAX_LENGTH = 60;

/**
 * 一覧・CSV の並び。
 * - occurred: 訪問日時の新しい順(記録の日時 occurred_at DESC, id DESC。既定)
 * - saved: 保存した順(最初に保存した日時 created_at DESC, id DESC。GAS版の「日報」シートで保存するたびに
 *   行が足されていたのと同じく、書いたばかりの報告が上に来る。上書き保存は同じ記録を直すため順は変わらない)
 */
export const REPORT_LIST_SORTS = ['occurred', 'saved'] as const;
export type ReportListSort = (typeof REPORT_LIST_SORTS)[number];
export const reportListSortSchema = z.enum(REPORT_LIST_SORTS);

export const REPORT_LIST_SORT_LABELS: Record<ReportListSort, string> = {
  occurred: '訪問日時の新しい順',
  saved: '保存した順',
};

const optionalId = idSchema.optional();

const reportCriteriaShape = {
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
  /** 書いたスタッフ(一般スタッフは送っても本人になる)。 */
  staffId: optionalId,
  customerId: optionalId,
  /** 並び(省略は occurred)。期間はどちらの並びでも記録の日時で絞る。 */
  sort: reportListSortSchema.default('occurred'),
};

const rangeRefine = <T extends { from?: string | undefined; to?: string | undefined }>(q: T) =>
  !q.from || !q.to || q.from <= q.to;
const rangeMessage = { message: '期間の開始日は終了日より前にしてください', path: ['from'] };

/**
 * GET /api/reports の条件。
 * - from / to: テナントのタイムゾーンの業務日(記録の日時。両端を含む)。省略時は今日までの31日間。期間は366日まで。
 * - staffId: 書いたスタッフ。一般スタッフは無視して本人に固定する
 * - customerId: お客様
 * - kind: 種類(省略はすべて)
 * - sort: 並び(occurred = 訪問日時の新しい順(既定)/ saved = 保存した順)
 * - cursor: 前のページの nextCursor(同じ sort で使う。別の並びの続きの位置は 400 invalid_cursor)
 */
export const reportListQuerySchema = z
  .object({
    ...reportCriteriaShape,
    kind: reportKindSchema.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(REPORT_LIST_MAX_PAGE_SIZE).default(30),
  })
  .refine(rangeRefine, rangeMessage);
export type ReportListQuery = z.input<typeof reportListQuerySchema>;

/**
 * GET /api/reports/export.csv の条件(コーディネーター・管理者だけ)。sheet で列の形を選ぶ。行の順は一覧と同じ sort。
 * kind は sheet に合う種類だけ(accident のシートで事故報告だけ・ヒヤリハットだけに絞る)。
 */
export const reportCsvQuerySchema = z
  .object({
    ...reportCriteriaShape,
    sheet: z.enum(REPORT_CSV_SHEETS),
    kind: reportKindSchema.optional(),
  })
  .refine(rangeRefine, rangeMessage)
  .refine((q) => !q.kind || (q.sheet === 'daily') === (q.kind === 'daily_report'), {
    message: '書き出す形と種類が合っていません',
    path: ['kind'],
  });
export type ReportCsvQuery = z.input<typeof reportCsvQuerySchema>;

/** 一覧の1件。 */
export const reportListItemSchema = z.object({
  id: idSchema,
  kind: reportKindSchema,
  /** 記録の日時(ISO8601。日報は訪問日の開始時刻、事故報告は保存した時刻)。 */
  occurredAt: z.string(),
  /** テナントのタイムゾーンの 'YYYY-MM-DD'。 */
  date: businessDateSchema,
  /** 日報は '開始〜終了'(入力が無ければ記録の時刻)、事故報告は記録の時刻 'HH:mm'。 */
  time: z.string(),
  staffId: idSchema,
  /** 書いたスタッフの氏名(削除されたスタッフは null)。 */
  staffName: z.string().nullable(),
  customerId: idSchema,
  customerName: z.string().nullable(),
  /** 本文の抜粋(日報は事務局に送る文、事故報告は事故の内容。無ければ書いたメモ)。 */
  excerpt: z.string(),
  riskRating: z.number().int().nullable(),
  esRating: z.number().int().nullable(),
  /** 最後に保存された日時(ISO8601)。 */
  updatedAt: z.string(),
  /** 最初に保存した日時(ISO8601。sort=saved の並びのキー)。 */
  createdAt: z.string(),
});
export type ReportListItem = z.infer<typeof reportListItemSchema>;

/** GET /api/reports(sort の順)。 */
export const reportListResponseSchema = z.object({
  reports: z.array(reportListItemSchema),
  nextCursor: z.string().nullable(),
  /** 実際に使った期間(省略時の既定を埋めたもの)。 */
  range: z.object({ from: businessDateSchema, to: businessDateSchema }),
  timeZone: z.string(),
});
export type ReportListResponse = z.infer<typeof reportListResponseSchema>;

const reportDetailBase = {
  id: idSchema,
  occurredAt: z.string(),
  date: businessDateSchema,
  time: z.string(),
  updatedAt: z.string(),
  /** 最初に保存した日時(ISO8601)。 */
  createdAt: z.string(),
  staffId: idSchema,
  staffName: z.string().nullable(),
  customerId: idSchema,
  customerName: z.string().nullable(),
  rowVersion: z.number().int().positive(),
  /** 保存し直された回数(care_record_revisions の件数)。 */
  revisionCount: z.number().int().nonnegative(),
};

/** GET /api/reports/:id(読むだけ。直すのは日報ダイアログ)。 */
export const reportDetailSchema = z.discriminatedUnion('kind', [
  z.object({
    ...reportDetailBase,
    kind: z.literal('daily_report'),
    riskRating: z.number().int().nullable(),
    esRating: z.number().int().nullable(),
    content: z.object({
      startTime: z.string(),
      endTime: z.string(),
      inputText: z.string(),
      internalText: z.string(),
      customerText: z.string(),
    }),
  }),
  z.object({
    ...reportDetailBase,
    kind: z.enum(['accident', 'near_miss']),
    content: z.object({
      targetName: z.string(),
      targetDob: z.string(),
      occurrenceTime: z.string(),
      location: z.string(),
      accidentContent: z.string(),
      situation: z.string(),
      immediateResponse: z.string(),
      parentCorrespondence: z.string(),
      diagnosisTreatment: z.string(),
      prevention: z.string(),
      inputText: z.string(),
    }),
  }),
]);
export type ReportDetail = z.infer<typeof reportDetailSchema>;
export const reportDetailResponseSchema = z.object({ report: reportDetailSchema, timeZone: z.string() });
export type ReportDetailResponse = z.infer<typeof reportDetailResponseSchema>;

/** 事故報告の項目の表示名(詳細・CSV の見出しで共有。日報ダイアログの正式な呼び方)。 */
export const ACCIDENT_FIELD_LABELS = {
  targetName: '対象児童名',
  targetDob: '生年月日',
  occurrenceTime: '発生日時',
  location: '発生場所',
  accidentContent: '事故内容',
  situation: '発生状況',
  immediateResponse: '発生時の対応',
  parentCorrespondence: '保護者への対応',
  diagnosisTreatment: '診断名・処置',
  prevention: '今後の対応',
  inputText: '元のメモ',
} as const;

/** 日報の本文の表示名(詳細・CSV の見出しで共有)。 */
export const DAILY_FIELD_LABELS = {
  startTime: '開始時刻',
  endTime: '終了時刻',
  inputText: '書いたメモ',
  internalText: '事務局に送る文',
  customerText: '保護者に送る文',
} as const;
