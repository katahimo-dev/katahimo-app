/**
 * 予約(reservations)とスタッフの割当(reservation_assignments)のリポジトリ。
 *
 * 表はマッチング拡張(doc/10_マッチング拡張設計.md)のもの。いまは公開デモの `pnpm demo:reset` が今日・明日の予定を
 * 入れ(create)、SCHEDULE_PROVIDER=database の予定の取得がスタッフの確定した訪問を読む(listConfirmedVisitsForStaffOnDate)
 * ことにだけ使う。管理者の割当のアプリを作るときは、この port に予約の登録・割当の提案・確定・取消を足していく。
 */

/** 予約1件と、その割当の登録(公開デモの予定)。ID はアプリが採番する(UUIDv7)。 */
export interface ReservationCreateInput {
  id: string;
  /** customers.id */
  customerId: string;
  /** 予定の時間帯 `[start, end)`。 */
  period: { start: Date; end: Date };
  /** テナントのタイムゾーンでの業務日('YYYY-MM-DD')。 */
  businessDate: string;
  /** 確定した予約だけを登録する(未確定の予約・提案はマッチングのアプリで扱う)。 */
  status: 'confirmed';
  /** 担当するスタッフ(確定した割当)。時間帯は予約と同じ。 */
  assignments: { id: string; staffId: string; confirmedAt: Date }[];
}

/** スタッフの確定した訪問1件(予定の取得に使う)。 */
export interface ConfirmedStaffVisit {
  reservationId: string;
  /** customers.id */
  customerId: string;
  /** 顧客の表示名(アーカイブされた顧客で、予定のマスタに無い場合の表示に使う)。 */
  customerDisplayName: string;
  start: Date;
  end: Date;
}

export interface ReservationRepository {
  create(input: ReservationCreateInput): Promise<void>;
  /**
   * スタッフのその業務日の確定した訪問(予約が confirmed / done で、そのスタッフの割当が confirmed のもの)を
   * 開始時刻順に返す。
   */
  listConfirmedVisitsForStaffOnDate(staffId: string, businessDate: string): Promise<ConfirmedStaffVisit[]>;
}
