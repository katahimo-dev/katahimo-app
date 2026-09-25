import type {
  ScheduleLightResult,
  SchedulePort,
  ScheduleWithRouteOptions,
  ScheduleWithRouteResult,
} from '@katahimo/core/ports';
import type { GasBridgeOptions } from './gasBridgeClient';
import { GasBridgeClient } from './gasBridgeClient';

/**
 * 「今日/明日の予定」をGAS版(gas-childcare-visit-app)のWeb Appデプロイ(Bridge.js)経由で取得する
 * 移行期の実装(SCHEDULE_PROVIDER=gas_bridge)。Bridge.jsはGAS版RouteSearch.jsの
 * getScheduleForStaffOnDate / getScheduleWithRouteForStaffOnDate をそのまま呼ぶ。
 *
 * 対象スタッフ名の解決(管理者以外は本人名に強制)はkatahimo-app側のusecase/session.tsで
 * 既に済ませてから呼ぶこと(CLAUDE.mdのセキュリティパターン)。
 */
export class GasBridgeSchedulePort implements SchedulePort {
  private readonly client: GasBridgeClient;

  constructor(options: GasBridgeOptions) {
    this.client = new GasBridgeClient(options);
  }

  async getSchedule(staffName: string, dateString: string): Promise<ScheduleLightResult> {
    return this.client.fetchJson<ScheduleLightResult>('schedule', { staffName, date: dateString });
  }

  /**
   * GAS側のキャッシュ(CacheService)は操作できないため、fresh指定時は forceRefresh として送る
   * (キャッシュは読まれない。計算結果がGAS側キャッシュに書かれる点だけがGoogleSchedulePortと異なる)。
   */
  async getScheduleWithRoute(
    staffName: string,
    dateString: string,
    forceRefresh: boolean,
    options?: ScheduleWithRouteOptions,
  ): Promise<ScheduleWithRouteResult> {
    return this.client.fetchJson<ScheduleWithRouteResult>('scheduleWithRoute', {
      staffName,
      date: dateString,
      forceRefresh: forceRefresh || options?.fresh ? '1' : '0',
    });
  }
}
