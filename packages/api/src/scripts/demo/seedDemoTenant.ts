import {
  type AttendanceRowPatch,
  COMMUTE_DISTANCE_COLUMN,
  geoCellOf,
  LEAVING_DISTANCE_COLUMN,
  MOVE_LEGS,
  newId,
  normalizeEmailForIndex,
  VISIT_SLOTS,
  WEATHER_OPTIONS,
} from '@katahimo/core/domain';
import type { TenantRecord } from '@katahimo/core/ports';
import {
  type Actor,
  type AttendanceSheetImportRow,
  applyCustomerSnapshot,
  importAttendanceSheetRows,
  registerStaff,
  saveAccidentReport,
  saveCustomerReportProfile,
  saveDailyReport,
  uploadReceipts,
} from '@katahimo/core/usecases';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '@katahimo/shared';
import type { Container } from '../../container';
import { DEMO_FIGURES, figureToCustomerSnapshot } from './figures';
import { demoReceiptImageDataUrl } from './receiptImages';
import { areaFigureIndexes, DEMO_STAFF_AREAS } from './staffAreas';
import { hashString, planVisitsForDate, recentBusinessDates, toJstDateIso } from './visitPlan';

/** 訪問履歴・出勤簿を作る期間(日、当日を含めるとこの日数+1)。 */
export const HISTORY_DAYS = 42;

export interface DemoSeedSummary {
  staffCount: number;
  customerCount: number;
  dailyReportCount: number;
  accidentReportCount: number;
  attendanceDayCount: number;
  receiptCount: number;
  reportProfileCount: number;
  /** 予定タブ(SCHEDULE_PROVIDER=database)に出す今日・明日の予約の件数。 */
  reservationCount: number;
  /** 履歴を作った最後の業務日('YYYY-MM-DD')。 */
  generatedThrough: string;
}

const DAILY_REPORT_TEMPLATES: readonly {
  inputText: string;
  internalText: string;
  customerText: string;
}[] = [
  {
    inputText: '室内遊びを中心に過ごしました。積み木やブロックで集中して遊ぶ様子が見られました。',
    internalText: '午前は終始機嫌よく、保護者からの伝達事項は特にありませんでした。',
    customerText: '今日も元気に過ごされました。積み木遊びに集中されている姿が印象的でした。',
  },
  {
    inputText: '絵本の読み聞かせをきっかけに、言葉のやり取りを楽しむ時間を多く取りました。',
    internalText: 'いつもより甘えが強く、抱っこを求める場面が多かったです。体調に変化はなさそうです。',
    customerText: '絵本を読むと、真剣な表情でじっと聞いてくださっていました。',
  },
  {
    inputText: '天気が良かったため、ベランダで日光浴を兼ねた外気浴を行いました。',
    internalText: '水分補給のタイミングを声かけしながら進めました。特記事項はありません。',
    customerText: '気持ちよさそうに外の空気を感じておられました。',
  },
  {
    inputText: '手づかみ食べの練習を見守りながら、昼食の対応をしました。',
    internalText: '食事量はいつも通り。アレルギー対応の献立に問題はありませんでした。',
    customerText: 'お食事は残さず召し上がっていました。',
  },
  {
    inputText: 'ブロック遊びの後、お昼寝の準備をして静かな時間を過ごしました。',
    internalText: '入眠までやや時間がかかりましたが、最終的には落ち着いて眠られました。',
    customerText: 'お昼寝の前にたくさん遊んで、気持ちよさそうに休まれていました。',
  },
];

const ACCIDENT_TEMPLATES: readonly {
  reportType: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
}[] = [
  {
    reportType: 'ヒヤリハット',
    location: 'リビング',
    accidentContent: 'おもちゃ箱の角に足をぶつけそうになった。',
    situation: '転倒には至らず、本人もすぐに気を取り直して遊びを再開した。',
    immediateResponse: 'おもちゃ箱の配置を壁際に寄せ、周囲のスペースを広げた。',
  },
  {
    reportType: '事故報告',
    location: '玄関',
    accidentContent: '段差でつまずき、軽く膝を床にぶつけた。',
    situation: '軽い発赤のみで、泣き止んだ後は普段通りに過ごされた。',
    immediateResponse: '患部を冷やし、保護者へお迎え時に状況を口頭でお伝えした。',
  },
];

function actorOfStaff(tenantId: string, staff: { id: string; role: Actor['role'] }): Actor {
  return { tenantId, staffId: staff.id, role: staff.role, meta: {} };
}

/** 出勤簿(rowData)の1日ぶんの訪問枠パッチ(sheetLayout.ts の名前付き定義だけを使う)。 */
function attendancePatchForVisits(
  visits: { figureIndex: number; start: string; end: string }[],
  customerNameOf: (figureIndex: number) => string,
): AttendanceRowPatch {
  const patch: AttendanceRowPatch = {};
  visits.forEach((visit, i) => {
    const slot = VISIT_SLOTS[i];
    if (!slot) return;
    patch[slot.title] = customerNameOf(visit.figureIndex);
    patch[slot.start] = visit.start;
    patch[slot.end] = visit.end;
  });
  if (visits.length > 0) {
    patch[COMMUTE_DISTANCE_COLUMN] = '5.00';
    patch[LEAVING_DISTANCE_COLUMN] = '5.00';
  }
  for (let i = 0; i < visits.length - 1; i++) {
    const leg = MOVE_LEGS[i];
    if (!leg) continue;
    patch[leg.plannedMinutes] = '15';
    patch[leg.weather] = WEATHER_OPTIONS[0] as string;
    patch[leg.distanceKm] = '3.00';
  }
  return patch;
}

/**
 * 公開デモ用のテナントにデータを一式投入する。全て本番の usecase 経由で書く(SQLを直接流し込まない。
 * outbox・RLS・ミラー判定など本番と同じ経路を通す)。
 *
 * - スタッフ: `@katahimo/shared` DEMO_ACCOUNTS の3人(admin/coordinator/staff)。
 * - 顧客: `figures.ts` の20世帯(RESERVA取込と同じ `applyCustomerSnapshot`)。
 * - 日報: 「staff」役割のアカウントが、`visitPlan.ts` の決定論的な訪問予定に沿って過去 HISTORY_DAYS 日ぶん保存する
 *   (出勤簿と同じ予定を使うので、日報の担当・時間帯と出勤簿の訪問先が一致する)。
 * - 出勤簿: ログインする3人全員ぶん、同じ期間(+当日)を `importAttendanceSheetRows` で取り込む
 *   (source: 'import' は当月ロックの対象外なので、過去月も書ける)。
 * - 予定: ログインする3人全員ぶん、今日・明日の訪問を予約(reservations + 確定した割当)として入れる(出勤簿と同じ
 *   visitPlan.ts の予定。SCHEDULE_PROVIDER=database の予定タブ・翌日のお知らせがこれを読むので、Google カレンダーは要らない)。
 * - 事故報告・ヒヤリハット、教育思考★の一部、領収書を少数だけ追加する。
 */
export async function seedDemoTenant(
  container: Container,
  tenant: TenantRecord,
  now: Date,
): Promise<DemoSeedSummary> {
  // ── スタッフ ──────────────────────────────────────────────
  const staffByRole = new Map<string, { id: string; role: Actor['role']; name: string }>();
  for (const account of DEMO_ACCOUNTS) {
    const existing = await container.uow.run(tenant.id, (r) =>
      r.staff.findByLoginEmail(normalizeEmailForIndex(account.email)),
    );
    let staff: { id: string; role: Actor['role']; name: string };
    if (existing) {
      staff = { id: existing.id, role: existing.role, name: existing.displayName };
    } else {
      const created = await registerStaff(container, {
        tenantId: tenant.id,
        name: account.name,
        email: account.email,
        role: account.role,
        password: DEMO_PASSWORD,
      });
      staff = { id: created.id, role: created.role, name: created.displayName };
    }
    staffByRole.set(account.role, staff);
    // 自宅(関西圏。staffAreas.ts)の緯度経度を直接入れる(スタッフの更新の usecase は地図APIで住所を探すため。
    // デモには地図APIが無い)
    const home = DEMO_STAFF_AREAS[account.role];
    const geo = { lat: home.lat, lng: home.lng };
    await container.uow.run(tenant.id, (r) =>
      r.staff.update(staff.id, { home: { address: home.address, geo, geoCell: geoCellOf(geo) } }),
    );
  }
  const visitingStaff = staffByRole.get('staff');
  if (!visitingStaff) throw new Error('デモ用のスタッフ役割アカウントの作成に失敗しました');

  // ── 顧客(20世帯) ──────────────────────────────────────────
  const customerIdByFigureIndex = await container.uow.run(tenant.id, async (r) => {
    await r.importRuns.lockTenantCustomerImports();
    const ids: string[] = [];
    let changed = false;
    for (const figure of DEMO_FIGURES) {
      const outcome = await applyCustomerSnapshot(
        { runId: null },
        r,
        figureToCustomerSnapshot(figure, now),
        now,
      );
      if (outcome !== 'unchanged') changed = true;
      const linked = await r.customerSourceRecords.findByExternalId('reserva', figure.externalId);
      if (!linked) throw new Error(`顧客の取込に失敗しました(externalId=${figure.externalId})`);
      ids.push(linked.customerId);
    }
    if (changed) await r.settings.bumpCustomerDataVersion();
    return ids;
  });
  const customerNameOf = (figureIndex: number) => {
    const figure = DEMO_FIGURES[figureIndex];
    return figure ? `${figure.familyName} ${figure.givenName}` : '';
  };

  // ── 家庭の教育思考★(5世帯だけ、GAS版に無い機能なので触れておく。日報を書くスタッフの担当の世帯に★1〜5) ──────
  const adminActor = actorOfStaff(tenant.id, staffByRole.get('admin') ?? visitingStaff);
  let reportProfileCount = 0;
  for (const [i, figureIndex] of areaFigureIndexes(visitingStaff.role).slice(0, 5).entries()) {
    const customerId = customerIdByFigureIndex[figureIndex];
    if (!customerId) continue;
    await saveCustomerReportProfile(container, adminActor, customerId, { educationLevel: i + 1 });
    reportProfileCount++;
  }

  // ── 日報(過去 HISTORY_DAYS 日 + 当日、visitPlan.ts の決定論的な予定どおり) ───
  const today = toJstDateIso(now);
  const businessDates = [...recentBusinessDates(now, HISTORY_DAYS), today];
  // 今日の日報は、作った時刻までに終わった訪問だけ(夜中の作り直しでは今日の日報は無く、出勤簿の予定だけになる)
  const nowHHmm = jstTimeOf(now);
  const staffActor = actorOfStaff(tenant.id, visitingStaff);
  let dailyReportCount = 0;
  for (const date of businessDates) {
    const visits = planVisitsForDate(date, visitingStaff.name, areaFigureIndexes(visitingStaff.role)).filter(
      (visit) => date !== today || visit.end <= nowHHmm,
    );
    for (const visit of visits) {
      const customerId = customerIdByFigureIndex[visit.figureIndex];
      if (!customerId) continue;
      const templateIndex = hashString(`${date}|${visit.figureIndex}`) % DAILY_REPORT_TEMPLATES.length;
      const template = DAILY_REPORT_TEMPLATES[templateIndex] as (typeof DAILY_REPORT_TEMPLATES)[number];
      const { riskRating, esRating } = demoRatings(`${date}|${visit.figureIndex}`);
      await saveDailyReport(container, staffActor, {
        customerId,
        reportDate: date,
        startTime: visit.start,
        endTime: visit.end,
        inputText: template.inputText,
        internalText: template.internalText,
        customerText: template.customerText,
        riskRating,
        esRating,
      });
      dailyReportCount++;
    }
  }

  // ── 事故報告・ヒヤリハット(少数、記録日時は常に保存時刻) ─────────────────
  let accidentReportCount = 0;
  for (const [i, template] of ACCIDENT_TEMPLATES.entries()) {
    const customerId = customerIdByFigureIndex[i];
    const figure = DEMO_FIGURES[i];
    if (!customerId || !figure) continue;
    const child = figure.children[0];
    await saveAccidentReport(container, staffActor, {
      customerId,
      reportType: template.reportType,
      targetName: child ? `${figure.familyName} ${child.givenName}` : customerNameOf(i),
      targetDob: '',
      occurrenceTime: '10:30',
      location: template.location,
      accidentContent: template.accidentContent,
      situation: template.situation,
      immediateResponse: template.immediateResponse,
      parentCorrespondence: 'お迎え時に状況をご説明し、ご了承いただいた。',
      diagnosisTreatment: '受診の必要はなし。',
      prevention: '同様の事故が起きないよう、環境を見直した。',
      inputText: template.accidentContent,
    });
    accidentReportCount++;
  }

  // ── 出勤簿(ログインする3人全員ぶん。当月ロックの対象外の import 経由) ─────
  let attendanceDayCount = 0;
  for (const staff of staffByRole.values()) {
    const rows: AttendanceSheetImportRow[] = businessDates.map((date, i) => ({
      rowNumber: i + 1,
      businessDate: date,
      rowData: attendancePatchForVisits(
        planVisitsForDate(date, staff.name, areaFigureIndexes(staff.role)),
        customerNameOf,
      ),
    }));
    const result = await importAttendanceSheetRows(container, tenant.id, staff.id, rows);
    attendanceDayCount += result.imported;
  }

  // ── 予定(今日・明日の予約。3人全員ぶん、出勤簿と同じ visitPlan.ts の予定) ──────
  // 予約の登録の usecase はまだ無い(マッチングのアプリで作る)ため、リポジトリで直接入れる
  const scheduleDates = [today, toJstDateIso(new Date(now.getTime() + 24 * 60 * 60 * 1000))];
  const reservationCount = await container.uow.run(tenant.id, async (r) => {
    let count = 0;
    for (const staff of staffByRole.values()) {
      for (const date of scheduleDates) {
        for (const visit of planVisitsForDate(date, staff.name, areaFigureIndexes(staff.role))) {
          const customerId = customerIdByFigureIndex[visit.figureIndex];
          if (!customerId) continue;
          const period = { start: jstInstant(date, visit.start), end: jstInstant(date, visit.end) };
          await r.reservations.create({
            id: newId(),
            customerId,
            period,
            businessDate: date,
            status: 'confirmed',
            assignments: [{ id: newId(), staffId: staff.id, confirmedAt: now }],
          });
          count++;
        }
      }
    }
    return count;
  });

  // ── 領収書(今月数枚・先月数枚、お客様請求/会社負担を混ぜる) ────────────
  // 日付は業務日の月で決める(月の初めでも「今月」の分があり、「先月」の分が2か月前にならないように)
  const receiptSpecs: {
    date: string;
    amount: number;
    storeName: string;
    companyPaid: boolean;
    customerIndex: number | null;
  }[] = [
    {
      date: thisMonthDate(today, 1),
      amount: 1200,
      storeName: 'コインパーキング梅田',
      companyPaid: true,
      customerIndex: null,
    },
    {
      date: thisMonthDate(today, 3),
      amount: 480,
      storeName: 'コンビニ堂島店',
      companyPaid: false,
      customerIndex: 0,
    },
    {
      date: thisMonthDate(today, 5),
      amount: 2600,
      storeName: '文房具の丸善',
      companyPaid: false,
      customerIndex: 3,
    },
    {
      date: thisMonthDate(today, 7),
      amount: 950,
      storeName: 'ガソリンスタンド北浜',
      companyPaid: true,
      customerIndex: null,
    },
    {
      date: previousMonthDate(today, 10),
      amount: 1500,
      storeName: 'コインパーキング本町',
      companyPaid: true,
      customerIndex: null,
    },
    {
      date: previousMonthDate(today, 20),
      amount: 720,
      storeName: 'スーパー生協南堀江',
      companyPaid: false,
      customerIndex: 1,
    },
  ];
  let receiptCount = 0;
  for (const [i, spec] of receiptSpecs.entries()) {
    // 今日の分は作った時刻より前にする(夜中の作り直しで未来の時刻にならないように)
    const time = spec.date === today ? '00:0' : '09:1';
    const fallbackTimestamp = `${spec.date.replace(/-/g, '/')} ${time}${i}:00`;
    const customerId =
      spec.customerIndex === null ? null : (customerIdByFigureIndex[spec.customerIndex] ?? null);
    await uploadReceipts(container, staffActor, {
      customerId,
      customerNameText: spec.customerIndex === null ? '（移動経費）' : undefined,
      images: [
        {
          data: demoReceiptImageDataUrl(i + 1),
          amount: spec.amount,
          storeName: spec.storeName,
          companyPaid: spec.companyPaid,
        },
      ],
      fallbackTimestamp,
      handoffText: '',
    });
    receiptCount++;
  }

  return {
    staffCount: staffByRole.size,
    customerCount: customerIdByFigureIndex.length,
    dailyReportCount,
    accidentReportCount,
    attendanceDayCount,
    receiptCount,
    reportProfileCount,
    reservationCount,
    generatedThrough: toJstDateIso(now),
  };
}

/** 業務日('YYYY-MM-DD')と日本時間の 'HH:mm' の時刻。 */
export function jstInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+09:00`);
}

/** 'HH:mm'(日本時間)。 */
function jstTimeOf(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

/**
 * 日報の PSI(riskRating)と ES。PSI はほとんど 3〜5 にし、2(注意)を40件に1件ほど混ぜる(1 = エスカレーションは作らない。
 * PSI 2 以下は管理者への知らせと報告一覧の印になるため、多すぎると不自然)。
 */
export function demoRatings(seed: string): { riskRating: number; esRating: number } {
  const h = hashString(`rating|${seed}`);
  return { riskRating: h % 40 === 0 ? 2 : 3 + (h % 3), esRating: 2 + (hashString(`es|${seed}`) % 4) };
}

/** 今日('YYYY-MM-DD')と同じ月の、daysBefore 日前の日付(月の1日より前にはしない)。 */
export function thisMonthDate(today: string, daysBefore: number): string {
  const day = Math.max(1, Number(today.slice(8, 10)) - daysBefore);
  return `${today.slice(0, 7)}-${String(day).padStart(2, '0')}`;
}

/** 今日('YYYY-MM-DD')の前の月の day 日(1〜28)。 */
export function previousMonthDate(today: string, day: number): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1];
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
