import type { ScheduleLightResult, SchedulePort, ScheduleWithRouteResult } from '@katahimo/core/ports';
import type { GasBridgeOptions } from './gasBridgeClient';
import { GasBridgeClient } from './gasBridgeClient';

/**
 * 「今日/明日の予定」をGAS版(gas-childcare-visit-app)のWeb Appデプロイ(Bridge.js)経由で取得する。
 * Bridge.js側はGAS版RouteSearch.jsの既存関数(getScheduleForStaffOnDate/
 * getScheduleWithRouteForStaffOnDate、本番で動いているカレンダー解析・ルート計算ロジックを
 * そのまま使う)を呼ぶだけなので、この移行期はカレンダーの分類ロジックをTypeScript側で
 * 再実装しない(誤って本番と挙動がずれるリスクを避けるため)。
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

  async getScheduleWithRoute(
    staffName: string,
    dateString: string,
    forceRefresh: boolean,
  ): Promise<ScheduleWithRouteResult> {
    return this.client.fetchJson<ScheduleWithRouteResult>('scheduleWithRoute', {
      staffName,
      date: dateString,
      forceRefresh: forceRefresh ? '1' : '0',
    });
  }
}

/** GAS_BRIDGE_URL/GAS_BRIDGE_SECRET未設定時のフォールバック。常に「予定なし」を返す。 */
export class NoopSchedulePort implements SchedulePort {
  async getSchedule(): Promise<ScheduleLightResult> {
    return { success: true, appointments: [] };
  }
  async getScheduleWithRoute(): Promise<ScheduleWithRouteResult> {
    return { success: true, appointments: [] };
  }
}
