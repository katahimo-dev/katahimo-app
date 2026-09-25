import type { CustomerDetailView, FamilyMemberView } from '@katahimo/shared';
import { mapsLatLngSearchUrl, mapsSearchUrl } from '../../lib/mapsUrl';

/**
 * 「お客様の情報」の「住所・連絡先」の行(GAS版 showCustomerDetail の details)。
 *
 * GAS版は顧客CSV(RESERVA)の列をそのまま「列名: 値」で並べていた(顧客ID・パスワードは除く。
 * 値が空の列も出す)。新しいAPIは列ごとの項目で返すため、GAS版と同じ列名・同じ並び順に戻して出す。
 * 国番号・世帯全員の情報(お子様・ご家族の元の文)はAPIに無いため出さない
 * (お子様・ご家族は上の欄に1人ずつ出る)。
 */
export interface DetailRow {
  key: string;
  value: string;
  /** 値の右に出すボタン(地図 / メール / 電話) */
  action: DetailAction | null;
}

export interface DetailAction {
  kind: 'map' | 'mail' | 'tel';
  href: string;
}

type Detail = CustomerDetailView;

/** 'YYYY-MM-DD…' → 'YYYY/MM/DD'(GAS版の日付の表記) */
function slashDate(value: string | null): string {
  if (!value) return '';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : value;
}

/** ISO日時 → 'yyyy/MM/dd HH:mm'(JST。GAS版 fetchDataFromSheet の日時の表記) */
function jstDateTime(value: string | null): string {
  if (!value) return '';
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return value;
  const jst = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}/${p(jst.getUTCMonth() + 1)}/${p(jst.getUTCDate())} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}`;
}

/** 氏名を姓・名に分ける(取り込み時に「姓 名」をつなげているため、最初の空白で分ける)。 */
function splitName(name: string): [string, string] {
  const trimmed = name.trim();
  const m = trimmed.match(/^(\S+)\s+(.*)$/);
  return m ? [m[1] ?? '', m[2] ?? ''] : [trimmed, ''];
}

/** '35.63,139.64' → 緯度経度。読み取れなければ null */
export function parseLatLng(value: string | null): { lat: number; lng: number } | null {
  if (!value) return null;
  const m = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** GAS版と同じ列名・並び順(RESERVAの顧客CSVの列の順) */
const COLUMNS: Array<[string, (c: Detail) => string]> = [
  ['姓', (c) => splitName(c.name)[0]],
  ['名', (c) => splitName(c.name)[1]],
  ['姓（カナ）※必須項目', (c) => c.familyNameKana ?? ''],
  ['名（カナ）※必須項目', (c) => c.givenNameKana ?? ''],
  ['メールアドレス', (c) => c.email ?? ''],
  ['電話番号※必須項目', (c) => c.phone ?? ''],
  ['会員種別', (c) => c.memberType ?? ''],
  ['会員状況（有効／無効）', (c) => c.memberStatus ?? ''],
  ['会費支払方法（現地決済／銀行振込／口座振替／請求書払い）', (c) => c.paymentMethod ?? ''],
  ['会費支払状況（未払／支払済み）', (c) => c.paymentStatus ?? ''],
  ['顧客メモ', (c) => c.memo ?? ''],
  ['登録日時', (c) => jstDateTime(c.registeredAt)],
  ['最終更新日時', (c) => jstDateTime(c.externalLastUpdatedAt)],
  ['性別', (c) => c.gender ?? ''],
  ['年代', (c) => c.ageBracket ?? ''],
  ['住所', (c) => c.addressDetail ?? ''],
  ['駐車場', (c) => c.parkingArea ?? ''],
  ['駐車場番号・指定場所の詳細など', (c) => c.parkingDetail ?? ''],
  ['緊急連絡先', (c) => c.emergencyContact ?? ''],
  ['緊急連絡先の方（申請者との関係性）', (c) => c.emergencyContactRelation ?? ''],
  ['災害時の避難場所（最寄りの小中学校）', (c) => c.evacuationSite ?? ''],
  ['Benefit会員ID', (c) => c.benefitMemberId ?? ''],
  ['住所2', (c) => c.address2 ?? ''],
  ['住所2[適用開始日YYYY/MM/DD]', (c) => slashDate(c.address2StartDate)],
  ['住所2[適用終了日YYYY/MM/DD]', (c) => slashDate(c.address2EndDate)],
  ['緯度・経度', (c) => c.latLng ?? ''],
];

/**
 * 値の右に出すボタン(GAS版と同じ判定):
 * - 列名に「住所」を含み「2」を含まない → 地図(緯度経度があればその場所、無ければ住所で検索)
 * - 列名に「メール」を含む → メール、「電話」を含む → 電話(緑)
 */
export function detailAction(key: string, value: string, customer: Detail): DetailAction | null {
  if (!value) return null;
  if (key.includes('住所') && !key.includes('2')) {
    const latLng = parseLatLng(customer.latLng);
    return {
      kind: 'map',
      href: latLng ? mapsLatLngSearchUrl(latLng.lat, latLng.lng) : mapsSearchUrl(value),
    };
  }
  if (key.includes('メール')) return { kind: 'mail', href: `mailto:${value}` };
  if (key.includes('電話')) return { kind: 'tel', href: `tel:${value}` };
  return null;
}

export function buildDetailRows(customer: Detail): DetailRow[] {
  return COLUMNS.map(([key, read]) => {
    const value = read(customer);
    return { key, value, action: detailAction(key, value, customer) };
  });
}

/** お子様・ご家族の1人分(GAS版の family の表示) */
export interface FamilyRow {
  id: string;
  name: string;
  dob: string;
  /** 「アレルギー: 卵」/「アレルギー: なし」 */
  allergyLabel: string;
  info: string;
}

export function buildFamilyRows(members: readonly FamilyMemberView[]): FamilyRow[] {
  return members.map((m) => ({
    id: m.id,
    name: m.name,
    dob: slashDate(m.dob),
    allergyLabel: `アレルギー: ${m.allergy || 'なし'}`,
    info: m.info ?? '',
  }));
}
