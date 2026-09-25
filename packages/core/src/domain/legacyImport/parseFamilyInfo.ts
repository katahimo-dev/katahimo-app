import { normalizeDateStr } from './normalizeDateStr';

export interface ParsedFamilyMember {
  name: string;
  dob: string;
  info: string;
}

interface WorkingPerson {
  name: string;
  dob: string;
  infoList: string[];
  /** 直前の行でこの人物の氏名/生年月日を書き始めたばかりか(次の情報行を同じ人物に紐付けるための状態)。 */
  justStarted: boolean;
}

// 対応する日付表記: 西暦(区切り文字違い)/和暦(漢字)/元号略記(アルファベット)/8桁西暦。
// 移植元: gas-childcare-visit-app/CsvImport.js の parseFamilyInfo() 冒頭のコメントと同じ一覧。
const DATE_PATTERN =
  /((?:19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}|(?:明治|大正|昭和|平成|令和)\s*[0-9元]+\s*[.\-年]\s*[0-9]+\s*[.\-月]\s*[0-9]+\s*日?|(?:19|20)\d{2}年\d{1,2}月\d{1,2}日?|[MTSHRmtshr]\d{1,2}[./]\d{1,2}[./]\d{1,2}(?:生)?|(?:19|20)\d{6})/gi;

const INFO_KEYWORDS = [
  '職業',
  '勤務',
  '園',
  '学校',
  '社',
  'アレルギー',
  '疾患',
  '病',
  '薬',
  '申請',
  '検討',
  '利用',
  '金額',
  '備考',
  '共有',
  '男児',
  '女児',
  '時',
  '分',
  '保育園',
  '幼稚園',
  '未就学児',
  '母乳',
  '発達',
  'クラス',
  '理学療法士',
  '作業療法士',
  '公務員',
  '役員',
  '落花生',
  'いわし',
  '整備士',
  '医師',
];

const SHORT_ROLE_WORDS = [
  '主婦',
  '夫',
  '妻',
  'パート',
  '学生',
  '無職',
  '会社員',
  '自営業',
  'ケアマネージャー',
  '介護職',
  '教員',
  '医師',
  '整備士',
  '保育士',
];

/**
 * RESERVA(外部予約システム)の顧客CSV「世帯全員の情報」欄(自由記述、複数人分を改行区切りで
 * 含む)を、世帯構成員ごとの { name, dob, info } に分解する。
 *
 * 移植元: gas-childcare-visit-app/CsvImport.js の parseFamilyInfo()。表記ゆれの激しい
 * 自由記述欄を実運用で磨いてきたヒューリスティックのため、ロジック自体は書き直さず
 * そのまま移植する(何を変えると何が壊れるかが自明ではないため)。
 */
export function parseFamilyInfo(rawText: string): ParsedFamilyMember[] {
  const results: ParsedFamilyMember[] = [];
  if (!rawText) return results;

  const lines = rawText.split(/[\r\n]+/);

  let current: WorkingPerson = { name: '', dob: '', infoList: [], justStarted: false };

  const flush = () => {
    if (current.name || current.dob) {
      const name = current.name ? current.name.replace(/^\([^)]+\)\s*/, '').trim() : current.name;
      results.push({ name, dob: current.dob, info: current.infoList.join(' ') });
    }
    current = { name: '', dob: '', infoList: [], justStarted: false };
  };

  for (const line of lines) {
    let clean = line.trim();
    if (!clean) continue;

    if (clean.startsWith('・')) {
      clean = clean.substring(1).trim();
    }

    // 「氏名（日付、情報、...）」形式の丸括弧を「氏名 情報」形式に展開する
    let inParens = false;
    if (clean.includes('（') && clean.includes('）')) {
      const parenMatch = clean.match(/^([^（]+)（([^）]+)）$/);
      if (parenMatch) {
        const name = (parenMatch[1] ?? '').trim();
        const content = (parenMatch[2] ?? '').trim();
        clean = `${name} ${content.replace(/、/g, ' ')}`;
        inParens = true;
      }
    }

    if (!inParens) {
      clean = clean.replace(/、/g, ' ');
    }

    DATE_PATTERN.lastIndex = 0;
    const match = DATE_PATTERN.exec(clean);

    if (match) {
      const dateStr = match[0];
      const idx = match.index;
      let pre = clean.substring(0, idx).trim();
      let post = clean.substring(idx + dateStr.length).trim();

      pre = pre.replace(/^\([^)]+\)\s*/, '').trim();

      if (pre.includes('・')) {
        pre = (pre.split('・')[0] ?? '').trim();
      }
      if (post.startsWith('・')) {
        post = post.substring(1).trim();
      }
      if (post.includes('・')) {
        post = post.replace(/・/g, ' ');
      }

      const isProperty = /生年月日|誕生日|DOB|Date/.test(pre) || pre.endsWith(':') || pre.endsWith('：');

      if (isProperty) {
        if (current.dob && !current.justStarted) {
          flush();
        }
        current.dob = normalizeDateStr(dateStr);
        if (post) current.infoList.push(post);
        current.justStarted = false;
      } else if (current.name && !current.dob && pre === '') {
        current.dob = normalizeDateStr(dateStr);
        if (post) current.infoList.push(post);
        current.justStarted = false;
      } else {
        if (current.name || current.dob) flush();
        current.name = pre;
        current.dob = normalizeDateStr(dateStr);
        if (post) current.infoList.push(post);
        current.justStarted = true;
      }
      continue;
    }

    // 日付を含まない行: 氏名か付帯情報かをヒューリスティックで判定する
    const isInfoKey = INFO_KEYWORDS.some((k) => clean.includes(k));
    const isLong = clean.length > 20;
    const isLikelyName = !isInfoKey && !isLong;

    if (current.dob) {
      if (isLikelyName && !SHORT_ROLE_WORDS.includes(clean)) {
        flush();
        current.name = clean;
        current.justStarted = true;
      } else {
        current.infoList.push(clean);
      }
    } else if (!current.name) {
      if (isLikelyName) {
        current.name = clean;
        current.justStarted = true;
      } else {
        current.infoList.push(clean);
      }
    } else if (current.name.length < 5 && isLikelyName) {
      current.name += ` ${clean}`;
    } else {
      current.infoList.push(clean);
    }
  }

  flush();
  return results;
}
