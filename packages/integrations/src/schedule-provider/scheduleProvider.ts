import type {
  AppLogPort,
  CachePort,
  GoogleCalendarPort,
  MapsPort,
  ScheduleDirectoryPort,
  SchedulePort,
} from '@katahimo/core/ports';
import { GasBridgeMapsPort, GasBridgeSchedulePort } from '../gas-bridge';
import type { GasBridgeOptions } from '../gas-bridge/gasBridgeClient';
import { createCalendarApiClient, GoogleCalendarApiPort } from '../google-calendar';
import { GoogleMapsPlatformPort } from '../google-maps';
import { GoogleSchedulePort } from '../google-schedule';
import { NoopMapsPort, NoopSchedulePort } from '../noop';

export const SCHEDULE_PROVIDERS = ['google', 'gas_bridge', 'noop'] as const;
export type ScheduleProvider = (typeof SCHEDULE_PROVIDERS)[number];

/** 予定・地図の実装選択に使う環境変数(api/worker の env から渡す)。 */
export interface ScheduleProviderEnv {
  SCHEDULE_PROVIDER?: ScheduleProvider | undefined;
  GOOGLE_MAPS_API_KEY?: string | undefined;
  GOOGLE_APPLICATION_CREDENTIALS?: string | undefined;
  GOOGLE_CALENDAR_IMPERSONATE?: string | undefined;
  GAS_BRIDGE_URL?: string | undefined;
  GAS_BRIDGE_SECRET?: string | undefined;
}

/**
 * SCHEDULE_PROVIDER が未指定の場合の既定:
 * 1. GOOGLE_MAPS_API_KEY と GOOGLE_APPLICATION_CREDENTIALS が両方あれば google
 * 2. GAS_BRIDGE_URL と GAS_BRIDGE_SECRET が両方あれば gas_bridge
 * 3. どちらも無ければ noop(常に予定なし)
 * Cloud Run(Workload Identity)では GOOGLE_APPLICATION_CREDENTIALS を使わないため、
 * SCHEDULE_PROVIDER=google を明示すること。
 */
export function selectScheduleProvider(env: ScheduleProviderEnv): ScheduleProvider {
  if (env.SCHEDULE_PROVIDER) return env.SCHEDULE_PROVIDER;
  if (env.GOOGLE_MAPS_API_KEY && env.GOOGLE_APPLICATION_CREDENTIALS) return 'google';
  if (gasBridgeOptions(env)) return 'gas_bridge';
  return 'noop';
}

/**
 * 起動時の設定検証。本番は SCHEDULE_PROVIDER の明示を必須にする(Cloud Run は
 * GOOGLE_APPLICATION_CREDENTIALS を使わないため、自動選択だと気づかないまま noop(常に予定なし)になる)。
 */
export function scheduleEnvProblems(env: ScheduleProviderEnv, isProduction: boolean): string[] {
  if (isProduction && !env.SCHEDULE_PROVIDER) {
    return ['  - SCHEDULE_PROVIDER: 本番は google / gas_bridge / noop のいずれかを明示してください'];
  }
  return [];
}

export interface ScheduleServiceDeps {
  directory: ScheduleDirectoryPort;
  appLog: AppLogPort;
  routeCache: CachePort;
}

export interface ScheduleServices {
  provider: ScheduleProvider;
  schedule: SchedulePort;
  maps: MapsPort;
}

/** 選ばれた実装で SchedulePort / MapsPort を組み立てる。必須の設定が欠けていれば起動時に例外。 */
export function createScheduleServices(
  env: ScheduleProviderEnv,
  deps: ScheduleServiceDeps,
): ScheduleServices {
  const provider = selectScheduleProvider(env);
  const bridge = gasBridgeOptions(env);

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
        routeCache: deps.routeCache,
        appLog: deps.appLog,
      });
      return { provider, schedule, maps };
    }
    case 'gas_bridge':
      if (!bridge) {
        throw new Error('SCHEDULE_PROVIDER=gas_bridge には GAS_BRIDGE_URL と GAS_BRIDGE_SECRET が必要です');
      }
      return { provider, schedule: new GasBridgeSchedulePort(bridge), maps: new GasBridgeMapsPort(bridge) };
    case 'noop':
      return { provider, schedule: new NoopSchedulePort(), maps: new NoopMapsPort() };
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

function gasBridgeOptions(env: ScheduleProviderEnv): GasBridgeOptions | null {
  return env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
    ? { baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET }
    : null;
}
