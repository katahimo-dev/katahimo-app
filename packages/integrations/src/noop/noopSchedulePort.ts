import type {
  LatLng,
  MapsPort,
  RouteLeg,
  ScheduleLightResult,
  SchedulePort,
  ScheduleWithRouteResult,
} from '@katahimo/core/ports';

/** 予定の取得元が何も設定されていない場合(SCHEDULE_PROVIDER=noop)。常に「予定なし」を返す。 */
export class NoopSchedulePort implements SchedulePort {
  async getSchedule(): Promise<ScheduleLightResult> {
    return { success: true, appointments: [] };
  }
  async getScheduleWithRoute(): Promise<ScheduleWithRouteResult> {
    return { success: true, appointments: [] };
  }
}

/** 地図APIが何も設定されていない場合。常に「算出不可」を返す。 */
export class NoopMapsPort implements MapsPort {
  async geocode(): Promise<LatLng | null> {
    return null;
  }
  async route(): Promise<RouteLeg | null> {
    return null;
  }
}
