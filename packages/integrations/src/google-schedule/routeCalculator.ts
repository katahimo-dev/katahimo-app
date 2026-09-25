import type {
  AppointmentLegPlan,
  AppointmentLegs,
  LegSummary,
  Place,
  PlannedLeg,
} from '@katahimo/core/domain';
import { locationQueryFor, summarizeLeg, UNKNOWN_LEG } from '@katahimo/core/domain';
import type { LatLng, MapsPort, RouteLeg, TravelMode } from '@katahimo/core/ports';

/**
 * 1回の予定計算(1スタッフ×1日)の中で、ジオコーディング・経路計算を実行する。
 *
 * GAS版の実行内メモ(GEOCODE_MEMO_CACHE_ / DIRECTIONS_MEMO_CACHE_)に相当し、同じ住所・同じ
 * 区間を同じ計算の中で2回APIに問い合わせない。例外(通信・クォータ等)の結果は覚えず、その区間は
 * 算出不可('')として扱い failures に理由を残す(GAS版も失敗時は空欄にして処理を続けていた)。
 */
export class RouteCalculator {
  private readonly geocodes = new Map<string, Promise<LatLng | null>>();
  private readonly routes = new Map<string, Promise<RouteLeg | null>>();
  readonly failures: string[] = [];

  constructor(
    private readonly maps: MapsPort,
    private readonly businessDate: string,
    private readonly travelMode: TravelMode,
  ) {}

  async summarizePlan(plan: AppointmentLegPlan): Promise<AppointmentLegs> {
    const [attendance, move, leaving] = await Promise.all([
      this.summarize(plan.attendance),
      this.summarize(plan.move),
      this.summarize(plan.leaving),
    ]);
    return { attendance, move, leaving };
  }

  private async summarize(leg: PlannedLeg | null): Promise<LegSummary> {
    if (!leg) return UNKNOWN_LEG;
    const [origin, destination] = await Promise.all([this.locate(leg.from), this.locate(leg.to)]);
    if (!origin || !destination) return UNKNOWN_LEG;
    const route = await this.route(origin, destination);
    return route ? summarizeLeg(origin, destination, route, this.travelMode) : UNKNOWN_LEG;
  }

  private async locate(place: Place): Promise<LatLng | null> {
    const query = locationQueryFor(place, this.businessDate);
    if (!query) return null;
    if (query.kind === 'latLng') return query.latLng;
    return this.memoize(this.geocodes, query.address, 'geocode', () => this.maps.geocode(query.address));
  }

  private route(origin: LatLng, destination: LatLng): Promise<RouteLeg | null> {
    const key = `${origin.lat},${origin.lng}->${destination.lat},${destination.lng}:${this.travelMode}`;
    return this.memoize(this.routes, key, 'route', () =>
      this.maps.route(origin, destination, { travelMode: this.travelMode }),
    );
  }

  private memoize<T>(
    memo: Map<string, Promise<T | null>>,
    key: string,
    label: string,
    compute: () => Promise<T | null>,
  ): Promise<T | null> {
    const existing = memo.get(key);
    if (existing) return existing;
    const pending = compute().catch((e: unknown) => {
      memo.delete(key);
      this.failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    memo.set(key, pending);
    return pending;
  }
}
