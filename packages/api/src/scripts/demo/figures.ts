import type { CustomerSnapshot } from '@katahimo/core/usecases';

/**
 * 公開デモ用の架空データ(`pnpm demo:reset` が毎晩作り直す)。
 *
 * 実在の利用者情報は一切含めない、というのがこのファイルの存在理由そのもの。世帯主は歴史上の人物の名前を
 * 借りているが、住所の番地・電話番号・子どもの氏名と生年月日は全て架空で、実在の人物・住居とは無関係。
 * 緯度経度は市区町村のおおよその中心座標で、ルート表示を「それらしく」見せるためだけに使う。
 *
 * 元は `ohru131/katahimo-app`(公開デモ、UI/design reference)の同名ファイルの20世帯。externalId だけ
 * このアプリの取込(`CustomerSnapshot.externalId`)向けに `PD-0001`… を振り直している。
 */

export interface DemoChild {
  givenName: string;
  /** シード時の「今日」から何か月前に生まれたか(0〜6歳になる範囲)。 */
  ageMonths: number;
  info: string;
  /** 聞き取り済みのアレルギー(省略した子は「未確認」のまま残す)。 */
  allergy?: string | null;
}

export interface DemoFigure {
  /** CustomerSnapshot.externalId(RESERVA の顧客ID相当)。 */
  externalId: string;
  familyName: string;
  givenName: string;
  familyNameKana: string;
  givenNameKana: string;
  /** メールアドレス等ASCIIが必要な場所で使う識別子(苗字のローマ字)。 */
  slug: string;
  prefecture: string;
  city: string;
  /** 番地まで含む架空の住所(prefecture + city に続く部分)。 */
  addressDetail: string;
  lat: number;
  lng: number;
  phone: string;
  parkingArea: string;
  parkingDetail: string;
  memo: string;
  children: DemoChild[];
}

export const DEMO_FIGURES: readonly DemoFigure[] = [
  {
    externalId: 'PD-0001',
    familyName: '織田',
    givenName: '信長',
    familyNameKana: 'オダ',
    givenNameKana: 'ノブナガ',
    slug: 'oda',
    prefecture: '大阪府',
    city: '大阪市中央区',
    addressDetail: '大手前1-2-3 天守マンション601',
    lat: 34.6863,
    lng: 135.5259,
    phone: '090-1000-0001',
    parkingArea: 'マンション地下',
    parkingDetail: '来客用スペースB-4。管理人室でカードを借りる',
    memo: '玄関チャイムが鳴りにくいため、到着時は電話連絡をお願いしたいとのこと。',
    children: [
      { givenName: '信忠', ageMonths: 58, info: '積み木遊びが好き。人見知りは少ない。', allergy: 'なし' },
      { givenName: '徳', ageMonths: 19, info: '手づかみ食べの練習中。', allergy: '卵(加熱済みは可)' },
    ],
  },
  {
    externalId: 'PD-0002',
    familyName: '豊臣',
    givenName: '秀吉',
    familyNameKana: 'トヨトミ',
    givenNameKana: 'ヒデヨシ',
    slug: 'toyotomi',
    prefecture: '大阪府',
    city: '大阪市中央区',
    addressDetail: '法円坂2-4-8',
    lat: 34.682,
    lng: 135.525,
    phone: '090-1000-0002',
    parkingArea: '近隣コインパーキング',
    parkingDetail: '自宅前は駐停車不可。東へ80mのコインP(30分200円)を利用。',
    memo: 'ご本人は日中不在が多く、祖母が対応されることが多い。',
    children: [{ givenName: '秀頼', ageMonths: 33, info: '発語が増えてきた時期。絵本の読み聞かせを好む。' }],
  },
  {
    externalId: 'PD-0003',
    familyName: '緒方',
    givenName: '洪庵',
    familyNameKana: 'オガタ',
    givenNameKana: 'コウアン',
    slug: 'ogata',
    prefecture: '大阪府',
    city: '大阪市中央区',
    addressDetail: '北浜3-1-15 適塾ハイツ302',
    lat: 34.6925,
    lng: 135.5031,
    phone: '090-1000-0003',
    parkingArea: '路上',
    parkingDetail: '平日は駐車監視員の巡回が多い。短時間でも要注意。',
    memo: 'ご家族に医療従事者がおり、健康面の相談を受けることが多い。',
    children: [
      {
        givenName: '章',
        ageMonths: 46,
        info: 'ぜんそくの既往あり。季節の変わり目は注意。',
        allergy: 'ハウスダスト',
      },
    ],
  },
  {
    externalId: 'PD-0004',
    familyName: '与謝野',
    givenName: '晶子',
    familyNameKana: 'ヨサノ',
    givenNameKana: 'アキコ',
    slug: 'yosano',
    prefecture: '大阪府',
    city: '堺市堺区',
    addressDetail: '甲斐町東2-2-20',
    lat: 34.5733,
    lng: 135.483,
    phone: '090-1000-0004',
    parkingArea: '敷地内',
    parkingDetail: '門扉を開けて2台目に駐車可。',
    memo: 'きょうだいが多く、訪問時は在宅人数が変動する。',
    children: [
      { givenName: '光', ageMonths: 63, info: '来春就学予定。ひらがなに興味を持ち始めている。' },
      { givenName: '七瀬', ageMonths: 27, info: '人見知りがあるため、最初は距離を取ってほしいとのこと。' },
    ],
  },
  {
    externalId: 'PD-0005',
    familyName: '楠木',
    givenName: '正成',
    familyNameKana: 'クスノキ',
    givenNameKana: 'マサシゲ',
    slug: 'kusunoki',
    prefecture: '大阪府',
    city: '河内長野市',
    addressDetail: '長野町5-7-1',
    lat: 34.4592,
    lng: 135.5628,
    phone: '090-1000-0005',
    parkingArea: '敷地内',
    parkingDetail: '坂の途中のため、車止めを必ず使用すること。',
    memo: '最寄り駅から距離があり、天候によって移動時間が延びやすい。',
    children: [{ givenName: '正行', ageMonths: 41, info: '外遊びが好き。虫が苦手。' }],
  },
  {
    externalId: 'PD-0006',
    familyName: '徳川',
    givenName: '家康',
    familyNameKana: 'トクガワ',
    givenNameKana: 'イエヤス',
    slug: 'tokugawa',
    prefecture: '京都府',
    city: '京都市中京区',
    addressDetail: '二条城町1-1-4 ニ之丸レジデンス105',
    lat: 35.0142,
    lng: 135.7481,
    phone: '090-1000-0006',
    parkingArea: '敷地内',
    parkingDetail: '来客用1台分あり。事前に連絡すれば確保していただける。',
    memo: '記録の共有を重視されるため、訪問後の報告は当日中に送付。',
    children: [
      { givenName: '秀忠', ageMonths: 52, info: 'ルーティンを崩されるのを嫌う。予定変更は事前共有を。' },
    ],
  },
  {
    externalId: 'PD-0007',
    familyName: '坂本',
    givenName: '龍馬',
    familyNameKana: 'サカモト',
    givenNameKana: 'リョウマ',
    slug: 'sakamoto',
    prefecture: '京都府',
    city: '京都市中京区',
    addressDetail: '河原町通蛸薬師下ル2-14',
    lat: 35.008,
    lng: 135.769,
    phone: '090-1000-0007',
    parkingArea: '近隣コインパーキング',
    parkingDetail: '商店街の中のため、搬入時間帯(午前)は進入しづらい。',
    memo: '転居の予定があり、次年度の対応地区が変わる可能性あり。',
    children: [
      { givenName: '春', ageMonths: 22, info: '歩き始めたばかり。段差の多い間取りのため見守り必須。' },
    ],
  },
  {
    externalId: 'PD-0008',
    familyName: '藤原',
    givenName: '道長',
    familyNameKana: 'フジワラ',
    givenNameKana: 'ミチナガ',
    slug: 'fujiwara',
    prefecture: '京都府',
    city: '京都市上京区',
    addressDetail: '土御門町7-3',
    lat: 35.03,
    lng: 135.755,
    phone: '090-1000-0008',
    parkingArea: '敷地内',
    parkingDetail: '門から入って左手。道幅が狭いので切り返しに注意。',
    memo: '同居のご家族が多く、訪問時間の調整に配慮が必要。',
    children: [
      { givenName: '彰', ageMonths: 60, info: '数遊びが得意。集中が続くタイプ。' },
      { givenName: '頼通', ageMonths: 15, info: '離乳食後期。牛乳は未開始。' },
    ],
  },
  {
    externalId: 'PD-0009',
    familyName: '湯川',
    givenName: '秀樹',
    familyNameKana: 'ユカワ',
    givenNameKana: 'ヒデキ',
    slug: 'yukawa',
    prefecture: '京都府',
    city: '京都市左京区',
    addressDetail: '北白川追分町12-6',
    lat: 35.027,
    lng: 135.783,
    phone: '090-1000-0009',
    parkingArea: '近隣コインパーキング',
    parkingDetail: '大学周辺は満車になりやすい。午前中の訪問が無難。',
    memo: '質問が具体的なので、記録は数値・時間を添えて残すと喜ばれる。',
    children: [{ givenName: '春洋', ageMonths: 37, info: '図鑑が好き。言葉の理解が早い。' }],
  },
  {
    externalId: 'PD-0010',
    familyName: '明智',
    givenName: '光秀',
    familyNameKana: 'アケチ',
    givenNameKana: 'ミツヒデ',
    slug: 'akechi',
    prefecture: '京都府',
    city: '亀岡市',
    addressDetail: '荒塚町4-9-2',
    lat: 35.0136,
    lng: 135.5736,
    phone: '090-1000-0010',
    parkingArea: '敷地内',
    parkingDetail: '砂利敷き。雨天時はぬかるむ。',
    memo: '市街地から距離があるため、午後最後の訪問に組むことが多い。',
    children: [{ givenName: '珠', ageMonths: 49, info: '折り紙が好き。はさみの扱いは要見守り。' }],
  },
  {
    externalId: 'PD-0011',
    familyName: '平',
    givenName: '清盛',
    familyNameKana: 'タイラ',
    givenNameKana: 'キヨモリ',
    slug: 'taira',
    prefecture: '兵庫県',
    city: '神戸市兵庫区',
    addressDetail: '和田宮通6-2-11 港見マンション802',
    lat: 34.67,
    lng: 135.166,
    phone: '090-1000-0011',
    parkingArea: 'マンション地下',
    parkingDetail: '来客用は先着1台。空きがなければ隣接のコインPへ。',
    memo: '海沿いで風が強く、ベランダの安全確認を毎回依頼されている。',
    children: [
      { givenName: '重盛', ageMonths: 55, info: '水遊びが大好き。' },
      { givenName: '徳子', ageMonths: 12, info: '離乳食中期。' },
    ],
  },
  {
    externalId: 'PD-0012',
    familyName: '黒田',
    givenName: '官兵衛',
    familyNameKana: 'クロダ',
    givenNameKana: 'カンベエ',
    slug: 'kuroda',
    prefecture: '兵庫県',
    city: '姫路市',
    addressDetail: '本町5-18 城見テラス302',
    lat: 34.8151,
    lng: 134.6855,
    phone: '090-1000-0012',
    parkingArea: '敷地内',
    parkingDetail: 'カーポート下に駐車可。',
    memo: '当日の段取りを先に共有しておくと落ち着いて過ごせる。',
    children: [{ givenName: '鶴', ageMonths: 44, info: '積み木を高く積むことに熱中する。' }],
  },
  {
    externalId: 'PD-0013',
    familyName: '大石',
    givenName: '内蔵助',
    familyNameKana: 'オオイシ',
    givenNameKana: 'クラノスケ',
    slug: 'oishi',
    prefecture: '兵庫県',
    city: '赤穂市',
    addressDetail: '上仮屋1-14',
    lat: 34.755,
    lng: 134.39,
    phone: '090-1000-0013',
    parkingArea: '敷地内',
    parkingDetail: '門前に2台分。',
    memo: '訪問可能な曜日が限られており、原則として金曜午後。',
    children: [{ givenName: '松之丞', ageMonths: 30, info: '車のおもちゃに強い興味。' }],
  },
  {
    externalId: 'PD-0014',
    familyName: '近松',
    givenName: '門左衛門',
    familyNameKana: 'チカマツ',
    givenNameKana: 'モンザエモン',
    slug: 'chikamatsu',
    prefecture: '兵庫県',
    city: '尼崎市',
    addressDetail: '久々知3-1-8',
    lat: 34.7333,
    lng: 135.4064,
    phone: '090-1000-0014',
    parkingArea: '近隣コインパーキング',
    parkingDetail: '自宅前は一方通行。北側から進入すること。',
    memo: 'ごっこ遊びの相手を求められることが多い。',
    children: [{ givenName: '治兵衛', ageMonths: 51, info: '物語をよく覚えている。' }],
  },
  {
    externalId: 'PD-0015',
    familyName: '大伴',
    givenName: '家持',
    familyNameKana: 'オオトモ',
    givenNameKana: 'ヤカモチ',
    slug: 'otomo',
    prefecture: '奈良県',
    city: '奈良市',
    addressDetail: '法蓮町2-30-5',
    lat: 34.6851,
    lng: 135.8048,
    phone: '090-1000-0015',
    parkingArea: '敷地内',
    parkingDetail: '前面道路が狭く、バック駐車が必要。',
    memo: '祖父母世帯と近居。連絡先が複数あるため送信先の確認を。',
    children: [{ givenName: '書持', ageMonths: 39, info: '歌や手遊びが好き。' }],
  },
  {
    externalId: 'PD-0016',
    familyName: '柿本',
    givenName: '人麻呂',
    familyNameKana: 'カキノモト',
    givenNameKana: 'ヒトマロ',
    slug: 'kakinomoto',
    prefecture: '奈良県',
    city: '橿原市',
    addressDetail: '畝傍町5-2',
    lat: 34.509,
    lng: 135.793,
    phone: '090-1000-0016',
    parkingArea: '敷地内',
    parkingDetail: '砂利敷きスペースに1台。',
    memo: '静かな環境を好まれるため、訪問時の声量に配慮。',
    children: [{ givenName: '依羅', ageMonths: 25, info: '午睡の時間が13:00〜14:30。' }],
  },
  {
    externalId: 'PD-0017',
    familyName: '石田',
    givenName: '三成',
    familyNameKana: 'イシダ',
    givenNameKana: 'ミツナリ',
    slug: 'ishida',
    prefecture: '滋賀県',
    city: '長浜市',
    addressDetail: '石田町4-11',
    lat: 35.381,
    lng: 136.274,
    phone: '090-1000-0017',
    parkingArea: '敷地内',
    parkingDetail: '広めの土間前に駐車可。',
    memo: '書面での共有を好まれる。口頭説明のみでの完了は避ける。',
    children: [{ givenName: '重家', ageMonths: 47, info: 'ブロック遊びで長時間集中できる。' }],
  },
  {
    externalId: 'PD-0018',
    familyName: '井伊',
    givenName: '直弼',
    familyNameKana: 'イイ',
    givenNameKana: 'ナオスケ',
    slug: 'ii',
    prefecture: '滋賀県',
    city: '彦根市',
    addressDetail: '金亀町1-3',
    lat: 35.2745,
    lng: 136.2596,
    phone: '090-1000-0018',
    parkingArea: '近隣コインパーキング',
    parkingDetail: '観光シーズンは満車になりやすい。',
    memo: '訪問時間の変更に敏感。遅れる場合は必ず事前連絡を。',
    children: [{ givenName: '直憲', ageMonths: 34, info: '音の出るおもちゃを好む。' }],
  },
  {
    externalId: 'PD-0019',
    familyName: '紀',
    givenName: '貫之',
    familyNameKana: 'キノ',
    givenNameKana: 'ツラユキ',
    slug: 'kino',
    prefecture: '和歌山県',
    city: '和歌山市',
    addressDetail: '千旦ノ木1-22',
    lat: 34.23,
    lng: 135.1707,
    phone: '090-1000-0019',
    parkingArea: '敷地内',
    parkingDetail: '3台分あり。奥から詰めて駐車。',
    memo: '記録は文章で詳しく残してほしいとのご希望。要点だけの箇条書きは避ける。',
    children: [
      { givenName: '琴', ageMonths: 57, info: 'わらべ歌をよく口ずさむ。' },
      { givenName: '文', ageMonths: 18, info: '後追いが強く、保護者が離れると泣く。' },
    ],
  },
  {
    externalId: 'PD-0020',
    familyName: '華岡',
    givenName: '青洲',
    familyNameKana: 'ハナオカ',
    givenNameKana: 'セイシュウ',
    slug: 'hanaoka',
    prefecture: '和歌山県',
    city: '紀の川市',
    addressDetail: '西野山3-6',
    lat: 34.267,
    lng: 135.356,
    phone: '090-1000-0020',
    parkingArea: '敷地内',
    parkingDetail: '納屋の前に駐車可。',
    memo: '訪問先が最も遠く、往復の移動時間を多めに見積もる必要がある。',
    children: [{ givenName: '雲平', ageMonths: 43, info: '手先が器用。粘土遊びを好む。' }],
  },
];

/**
 * 子の生年月日を、シード時の「今日」から `ageMonths` か月前の1日にする('YYYY-MM-DD')。
 * 日を1日に固定しているのは、毎晩シードし直しても同じ月齢の間は同じ生年月日になるようにするため
 * (デモの「今日」は動くが、日付までは実在しないため気にしなくてよい)。
 */
export function birthDateFromAgeMonths(today: Date, ageMonths: number): string {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const d = new Date(Date.UTC(year, month - ageMonths, 1));
  return d.toISOString().slice(0, 10);
}

/** 1世帯分を、顧客の取込(applyCustomerSnapshot)が読める形にする。 */
export function figureToCustomerSnapshot(figure: DemoFigure, today: Date): CustomerSnapshot {
  return {
    source: 'reserva',
    externalId: figure.externalId,
    displayName: `${figure.familyName} ${figure.givenName}`,
    familyName: figure.familyName,
    givenName: figure.givenName,
    familyNameKana: figure.familyNameKana,
    givenNameKana: figure.givenNameKana,
    email: `${figure.slug}@public-demo.example.com`,
    phone: figure.phone,
    memo: figure.memo,
    attributes: { member_type: '定期利用' },
    home: {
      addressLine: `${figure.prefecture}${figure.city}${figure.addressDetail}`,
      prefecture: figure.prefecture,
      city: figure.city,
      parkingArea: figure.parkingArea,
      parkingDetail: figure.parkingDetail,
      latLng: `${figure.lat},${figure.lng}`,
    },
    secondary: null,
    emergencyContact: { relation: '母', phone: figure.phone },
    recipients: figure.children.map((child) => ({
      name: `${figure.familyName} ${child.givenName}`,
      birthDate: birthDateFromAgeMonths(today, child.ageMonths),
      needs: child.info,
      allergy: child.allergy ?? null,
    })),
  };
}
