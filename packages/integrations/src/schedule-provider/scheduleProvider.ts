import type {
  AppLogPort,
  CachePort,
  GoogleCalendarPort,
  MapsPort,
  ScheduleDirectoryPort,
  SchedulePort,
  TenantDirectoryPort,
  UnitOfWorkPort,
} from '@katahimo/core/ports';
import { DatabaseSchedulePort } from '../database-schedule';
import {
  type GasBridgeEnv,
  GasBridgeSchedulePort,
  GasBridgeTenantGuard,
  gasBridgeConfigOf,
} from '../gas-bridge';
import { createCalendarApiClient, GoogleCalendarApiPort } from '../google-calendar';
import { GoogleMapsPlatformPort } from '../google-maps';
import { GoogleSchedulePort } from '../google-schedule';
import { NoopSchedulePort } from '../noop';

export const SCHEDULE_PROVIDERS = ['google', 'gas_bridge', 'database', 'noop'] as const;
export type ScheduleProvider = (typeof SCHEDULE_PROVIDERS)[number];

/** 予定・地図の実装選択に使う環境変数(api/worker の env から渡す)。 */
export interface ScheduleProviderEnv extends Omit<GasBridgeEnv, 'SCHEDULE_PROVIDER'> {
  SCHEDULE_PROVIDER?: ScheduleProvider | undefined;
  GOOGLE_MAPS_API_KEY?: string | undefined;
  GOOGLE_APPLICATION_CREDENTIALS?: string | undefined;
  GOOGLE_CALENDAR_IMPERSONATE?: string | undefined;
}

/**
 * SCHEDULE_PROVIDER が未指定の場合の既定:
 * 1. GOOGLE_MAPS_API_KEY と GOOGLE_APPLICATION_CREDENTIALS が両方あれば google
 * 2. GAS_BRIDGE_URL・GAS_BRIDGE_SECRET・GAS_BRIDGE_TENANT が揃っていれば gas_bridge(そのテナントだけ予定を返す)
 * 3. どちらも無ければ noop(常に予定なし)
 * database(DB の予約を予定にする。公開デモ用)は自動では選ばない(明示したときだけ)。
 * Cloud Run(Workload Identity)では GOOGLE_APPLICATION_CREDENTIALS を使わないため、
 * SCHEDULE_PROVIDER=google を明示すること。
 */
export function selectScheduleProvider(env: ScheduleProviderEnv): ScheduleProvider {
  if (env.SCHEDULE_PROVIDER) return env.SCHEDULE_PROVIDER;
  if (env.GOOGLE_MAPS_API_KEY && env.GOOGLE_APPLICATION_CREDENTIALS) return 'google';
  if (gasBridgeConfigOf(env)) return 'gas_bridge';
  return 'noop';
}

/**
 * 起動時の設定検証。本番は SCHEDULE_PROVIDER の明示を必須にする(Cloud Run は
 * GOOGLE_APPLICATION_CREDENTIALS を使わないため、自動選択だと気づかないまま noop(常に予定なし)になる)。
 */
export function scheduleEnvProblems(env: ScheduleProviderEnv, isProduction: boolean): string[] {
  if (isProduction && !env.SCHEDULE_PROVIDER) {
    return [
      '  - SCHEDULE_PROVIDER: 本番は google / gas_bridge / database / noop のいずれかを明示してください',
    ];
  }
  return [];
}

export interface ScheduleServiceDeps {
  directory: ScheduleDirectoryPort;
  appLog: AppLogPort;
  mapsCache: CachePort;
  /** 閲覧用のカレンダーのイベント一覧の短期キャッシュ(GoogleSchedulePortDeps.calendarCache)。 */
  calendarCache: CachePort;
  /** database で、スタッフの確定した予約を読む。 */
  uow: UnitOfWorkPort;
  /** gas_bridge で、予定を求めたテナントが Bridge の持ち主か確かめるのに使う。 */
  tenants: Pick<TenantDirectoryPort, 'findById'>;
}

export interface ScheduleServices {
  provider: ScheduleProvider;
  schedule: SchedulePort;
  /**
   * スタッフの自宅住所のジオコーディングに使う地図 API(google だけ。database は区間を緯度経度から見積もり、地図 API を
   * 使わないため無し)。gas_bridge はルートを GAS版が計算するため
   * 本アプリの緯度経度を使わず、テナントを持たない地図の呼び出しで別のテナントの住所を Bridge に送らないよう、無し。
   */
  maps: MapsPort | null;
  /**
   * 予定を読めるテナントの slug(gas_bridge の GAS_BRIDGE_TENANT)。null なら全テナント。夜間の反映・翌日のお知らせの
   * ジョブは、これがあれば他のテナントを飛ばす(Bridge に求めても断られるだけのため)。
   */
  scheduleTenantSlug: string | null;
}

/** 選ばれた実装で SchedulePort / MapsPort を組み立てる。必須の設定が欠けていれば起動時に例外。 */
export function createScheduleServices(
  env: ScheduleProviderEnv,
  deps: ScheduleServiceDeps,
): ScheduleServices {
  const provider = selectScheduleProvider(env);
  const bridge = gasBridgeConfigOf(env);

  switch (provider) {
    case 'google': {
      if (!env.GOOGLE_MAPS_API_KEY) {
        throw new Error('SCHEDULE_PROVIDER=google には GOOGLE_MAPS_API_KEY が必要です');
      }
      const maps = new GoogleMapsPlatformPort({ apiKey: env.GOOGLE_MAPS_API_KEY });
      const schedule = new GoogleSchedulePort({
        calendar: createGoogleCalendarPort(env),
        maps,
        directory: deps.directory,
        mapsCache: deps.mapsCache,
        calendarCache: deps.calendarCache,
        appLog: deps.appLog,
      });
      return { provider, schedule, maps, scheduleTenantSlug: null };
    }
    case 'gas_bridge':
      if (!bridge) {
        throw new Error(
          'SCHEDULE_PROVIDER=gas_bridge には GAS_BRIDGE_URL・GAS_BRIDGE_SECRET・GAS_BRIDGE_TENANT が必要です',
        );
      }
      return {
        provider,
        schedule: new GasBridgeSchedulePort(
          bridge,
          new GasBridgeTenantGuard(bridge.tenantSlug, deps.tenants),
        ),
        maps: null,
        scheduleTenantSlug: bridge.tenantSlug,
      };
    case 'database':
      return {
        provider,
        schedule: new DatabaseSchedulePort({ uow: deps.uow, directory: deps.directory }),
        maps: null,
        scheduleTenantSlug: null,
      };
    case 'noop':
      return { provider, schedule: new NoopSchedulePort(), maps: null, scheduleTenantSlug: null };
  }
}

/** サービスアカウント(ADC)で読む GoogleCalendarPort。free/busy同期(ワーカー)からも使う。 */
export function createGoogleCalendarPort(
  env: Pick<ScheduleProviderEnv, 'GOOGLE_CALENDAR_IMPERSONATE'>,
): GoogleCalendarPort {
  return new GoogleCalendarApiPort(
    createCalendarApiClient({ impersonateSubject: env.GOOGLE_CALENDAR_IMPERSONATE || undefined }),
  );
}
