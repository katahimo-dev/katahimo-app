import type {
  ScheduleLightResult,
  SchedulePort,
  ScheduleRequestOptions,
  ScheduleTarget,
  ScheduleWithRouteOptions,
  ScheduleWithRouteResult,
} from '@katahimo/core/ports';
import type { GasBridgeOptions } from './gasBridgeClient';
import { GasBridgeClient } from './gasBridgeClient';
import type { GasBridgeTenantGuard } from './gasBridgeEnv';

/**
 * 「今日/明日の予定」をGAS版(gas-childcare-visit-app)のWeb Appデプロイ(Bridge.js)経由で取得する
 * 移行期の実装(SCHEDULE_PROVIDER=gas_bridge)。Bridge.jsはGAS版RouteSearch.jsの
 * getScheduleForStaffOnDate / getScheduleWithRouteForStaffOnDate をそのまま呼ぶ。
 *
 * GAS版はスタッフを氏名で扱うため、ScheduleTarget の氏名(DB の値)を送る。対象スタッフの解決(一般スタッフは
 * 本人に固定)は呼び出し側の usecase で済ませてから呼ぶこと(CLAUDE.md の admin-vs-self)。
 * Bridge は1つのテナント(GAS_BRIDGE_TENANT)の GAS版につながっているため、そのテナント以外(テナントの指定が
 * 無い呼び出しを含む)は Bridge に送らずに例外にする(別のテナントのスタッフ名で GAS版の予定を読ませない)。
 */
export class GasBridgeSchedulePort implements SchedulePort {
  private readonly client: GasBridgeClient;

  constructor(
    options: GasBridgeOptions,
    private readonly guard: GasBridgeTenantGuard,
  ) {
    this.client = new GasBridgeClient(options);
  }

  async getSchedule(
    target: ScheduleTarget,
    dateString: string,
    options?: ScheduleRequestOptions,
  ): Promise<ScheduleLightResult> {
    await this.guard.assertAllowed(options?.tenantId);
    return this.client.fetchJson<ScheduleLightResult>('schedule', {
      staffName: target.staffName,
      date: dateString,
    });
  }

  /**
   * GAS側のキャッシュ(CacheService)は操作できないため、fresh指定時は forceRefresh として送る
   * (キャッシュは読まれない。計算結果がGAS側キャッシュに書かれる点だけがGoogleSchedulePortと異なる)。
   */
  async getScheduleWithRoute(
    target: ScheduleTarget,
    dateString: string,
    forceRefresh: boolean,
    options?: ScheduleWithRouteOptions,
  ): Promise<ScheduleWithRouteResult> {
    await this.guard.assertAllowed(options?.tenantId);
    return this.client.fetchJson<ScheduleWithRouteResult>('scheduleWithRoute', {
      staffName: target.staffName,
      date: dateString,
      forceRefresh: forceRefresh || options?.fresh ? '1' : '0',
    });
  }
}
