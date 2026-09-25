import { excelSerialDateToIso, parseFamilyInfo } from '@katahimo/core/domain';
import { parse } from 'csv-parse/sync';
import { decodeReservaCsv, detectDelimiter } from './decode';
import type { ReservaCsvRow } from './types';

interface HeaderIndex {
  customerId: number;
  familyName: number;
  givenName: number;
  familyNameKana: number;
  givenNameKana: number;
  email: number;
  countryCode: number;
  phone: number;
  memberType: number;
  memberStatus: number;
  paymentMethod: number;
  paymentStatus: number;
  memo: number;
  registeredAt: number;
  lastUpdatedAt: number;
  gender: number;
  ageBracket: number;
  address: number;
  parkingArea: number;
  parkingDetail: number;
  emergencyContact: number;
  emergencyContactRelation: number;
  evacuationSite: number;
  familyInfo: number;
  benefitMemberId: number;
  address2: number;
  address2StartDate: number;
  address2EndDate: number;
  latLng: number;
}

/**
 * ヘッダーの中から、keywordsのいずれかを含み、かつexcludeのいずれも含まない最初の列を探す。
 * (keywordsはOR、excludeはAND-of-NOTで、AND条件が要る場合はより具体的な1つの文字列を渡すこと。
 * 例: 「住所2」と「開始日」を同時に含む列を狙って ['住所2','開始日'] のようにOR2語で書いても
 * ANDにはならない=最初にどちらかを含む列がヒットしてしまうので注意)
 */
function findIndex(header: string[], keywords: string[], exclude: string[] = []): number {
  return header.findIndex(
    (h) => keywords.some((k) => h.includes(k)) && !exclude.some((ex) => h.includes(ex)),
  );
}

/**
 * ヘッダー行の列名から、必要な列の位置を特定する。固定の列番号に依存しないことで、
 * RESERVA側のエクスポート列順が多少変わっても追従できるようにする
 * (移植元のGASコードも顧客ID/世帯列だけは同様にキーワード検索していた)。
 */
function resolveHeaderIndex(header: string[]): HeaderIndex {
  return {
    customerId: findIndex(header, ['顧客ID']),
    familyName: findIndex(header, ['姓'], ['カナ']),
    givenName: findIndex(header, ['名'], ['カナ']),
    familyNameKana: findIndex(header, ['姓（カナ', '姓(カナ']),
    givenNameKana: findIndex(header, ['名（カナ', '名(カナ']),
    email: findIndex(header, ['メールアドレス']),
    countryCode: findIndex(header, ['国番号']),
    phone: findIndex(header, ['電話番号']),
    memberType: findIndex(header, ['会員種別']),
    memberStatus: findIndex(header, ['会員状況']),
    paymentMethod: findIndex(header, ['会費支払方法']),
    paymentStatus: findIndex(header, ['会費支払状況']),
    memo: findIndex(header, ['顧客メモ']),
    registeredAt: findIndex(header, ['登録日時']),
    lastUpdatedAt: findIndex(header, ['最終更新日時']),
    gender: findIndex(header, ['性別']),
    ageBracket: findIndex(header, ['年代']),
    address: findIndex(header, ['住所'], ['住所2']),
    parkingArea: findIndex(header, ['駐車場'], ['番号']),
    parkingDetail: findIndex(header, ['駐車場番号']),
    emergencyContact: findIndex(header, ['緊急連絡先'], ['関係性']),
    emergencyContactRelation: findIndex(header, ['緊急連絡先の方']),
    evacuationSite: findIndex(header, ['避難場所']),
    familyInfo: findIndex(header, ['世帯']),
    benefitMemberId: findIndex(header, ['Benefit']),
    address2: findIndex(header, ['住所2'], ['開始日', '終了日']),
    // 「開始日」「終了日」はaddress2/address2StartDate/address2EndDateの3列中それぞれ1列にしか
    // 現れない語のため、単独キーワードで一意に特定できる(住所2とのAND条件は不要)。
    address2StartDate: findIndex(header, ['開始日']),
    address2EndDate: findIndex(header, ['終了日']),
    latLng: findIndex(header, ['緯度']),
  };
}

function col(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : '';
}

/**
 * RESERVA顧客CSVの生バイト列を、構造化された行の配列にデコード・パースする。
 *
 * エンコーディング判定・デリミタ判定・多行にまたがる引用符付きフィールドへの対応は
 * gas-childcare-visit-app/CsvImport.js の checkAndImportLatestCsv()/updateDatabaseFromLinesV2()
 * を踏襲する。「世帯全員の情報」欄はparseFamilyInfo()(同じくGAS版からの移植)でそのまま
 * 構造化し、子どもの情報を含め一切省略しない。
 */
export function parseReservaCsv(buffer: Buffer): ReservaCsvRow[] {
  const text = decodeReservaCsv(buffer);
  const delimiter = detectDelimiter(text);

  const rows: string[][] = parse(text, {
    delimiter,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
  });
  if (rows.length < 2) return [];

  const header = rows[0] ?? [];
  const idx = resolveHeaderIndex(header);

  return rows.slice(1).map((row) => {
    const familyInfoRaw = col(row, idx.familyInfo);
    return {
      customerId: col(row, idx.customerId),
      familyName: col(row, idx.familyName),
      givenName: col(row, idx.givenName),
      familyNameKana: col(row, idx.familyNameKana),
      givenNameKana: col(row, idx.givenNameKana),
      email: col(row, idx.email),
      countryCode: col(row, idx.countryCode),
      phone: col(row, idx.phone),
      memberType: col(row, idx.memberType),
      memberStatus: col(row, idx.memberStatus),
      paymentMethod: col(row, idx.paymentMethod),
      paymentStatus: col(row, idx.paymentStatus),
      memo: col(row, idx.memo),
      registeredAt: excelSerialDateToIso(col(row, idx.registeredAt)),
      externalLastUpdatedAt: excelSerialDateToIso(col(row, idx.lastUpdatedAt)),
      gender: col(row, idx.gender),
      ageBracket: col(row, idx.ageBracket),
      address: col(row, idx.address),
      parkingArea: col(row, idx.parkingArea),
      parkingDetail: col(row, idx.parkingDetail),
      emergencyContact: col(row, idx.emergencyContact),
      emergencyContactRelation: col(row, idx.emergencyContactRelation),
      evacuationSite: col(row, idx.evacuationSite),
      familyInfoRaw,
      familyMembers: parseFamilyInfo(familyInfoRaw),
      benefitMemberId: col(row, idx.benefitMemberId),
      address2: col(row, idx.address2),
      address2StartDate: col(row, idx.address2StartDate),
      address2EndDate: col(row, idx.address2EndDate),
      latLng: col(row, idx.latLng),
    };
  });
}
