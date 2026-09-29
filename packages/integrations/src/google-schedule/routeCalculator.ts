import { createHash } from 'node:crypto';
import type {
  AppointmentLegPlan,
  AppointmentLegs,
  LegSummary,
  Place,
  PlannedLeg,
} from '@katahimo/core/domain';
import { locationQueryFor, summarizeLeg, UNKNOWN_LEG } from '@katahimo/core/domain';
import type { CachePort, LatLng, MapsPort, MapsUsage, RouteLeg, TravelMode } from '@katahimo/core/ports';

/**
 * 区間(出発座標→到着座標・移動手段)ごとのルート結果・住所ごとのジオコーディング結果を持つ期間(6時間)。
 *
 * 予定そのもの(カレンダー)は閲覧でも毎回読み直すため(担当変更をすぐ出す)、ここで持つのは
 * 予定に依らない地図の結果だけ。経路は出発時刻を指定しない・交通状況を考慮しない(TRAFFIC_UNAWARE)ため
 * 同じ区間なら時刻によらず同じ結果になり、キーに時刻を含めない。
 * 閲覧用の値で、公式記録(出勤簿)へ書く fresh の経路はこのキャッシュを読まない。
 */
export const MAPS_RESULT_CACHE_TTL_SECONDS = 6 * 60 * 60;

/**
 * 公共交通機関(TRANSIT)は出発時刻を省くと Routes API が「いま」を出発時刻にするため、時刻で結果が変わる
 * (運行時間外は経路なしにもなる)。時間帯をキーに含めるほどの精度は閲覧に要らないため、キーは同じにして
 * 期間だけ短く(1時間)する。
 */
export const TRANSIT_ROUTE_CACHE_TTL_SECONDS = 60 * 60;

/**
 * 見つからなかった(住所が地図に無い・経路が無い = null)という結果を持つ期間(30分)。開くたびに同じ住所・区間を
 * 問い合わせ直して課金されないように短く覚える(住所を直したときも30分で調べ直す。🔄 最新にするならすぐ)。
 */
export const NOT_FOUND_CACHE_TTL_SECONDS = 30 * 60;

/** 共有キャッシュに入れる形(null = 見つからなかった、も覚えるため包む)。 */
interface CachedMapsResult<T> {
  value: T | null;
}

/** 地図の結果のキャッシュの使い方(閲覧: 読み書き / 🔄 最新にする: 書くだけ / fresh: 使わない)。 */
export interface MapsResultCache {
  cache: CachePort;
  /** キーに含める(座標・住所だけのキーでもテナントをまたいで使い回さない)。 */
  tenantId: string;
  /** false なら読まずに API を呼ぶ(結果は書く)。 */
  read: boolean;
}

/**
 * 1回の予定計算(1スタッフ×1日)の中で、ジオコーディング・経路計算を実行する。
 *
 * GAS版の実行内メモ(GEOCODE_MEMO_CACHE_ / DIRECTIONS_MEMO_CACHE_)に相当し、同じ住所・同じ
 * 区間を同じ計算の中で2回APIに問い合わせない。例外(通信・クォータ等)の結果は覚えず、その区間は
 * 算出不可('')として扱い failures に理由を残す(GAS版も失敗時は空欄にして処理を続けていた)。
 * sharedCache があれば、計算をまたいで区間・住所ごとの結果を使い回す(例外は書かず、次の閲覧で問い合わせ直す。
 * 見つからなかった(null)結果は短い期間だけ覚える)。usage に実際に地図APIを呼んだ回数とキャッシュで済ませた回数を数える。
 */
export class RouteCalculator {
  private readonly geocodes = new Map<string, Promise<LatLng | null>>();
  private readonly routes = new Map<string, Promise<RouteLeg | null>>();
  readonly failures: string[] = [];
  readonly usage: MapsUsage = { geocodeCalls: 0, routeCalls: 0, cacheHits: 0 };

  constructor(
    private readonly maps: MapsPort,
    private readonly businessDate: string,
    private readonly travelMode: TravelMode,
    private readonly sharedCache: MapsResultCache | null = null,
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
    return this.memoize(this.geocodes, query.address, 'geocode', () =>
      this.withSharedCache(['geocode', query.address], MAPS_RESULT_CACHE_TTL_SECONDS, () => {
        this.usage.geocodeCalls++;
        return this.maps.geocode(query.address);
      }),
    );
  }

  private route(origin: LatLng, destination: LatLng): Promise<RouteLeg | null> {
    const key = `${origin.lat},${origin.lng}->${destination.lat},${destination.lng}:${this.travelMode}`;
    const ttl =
      this.travelMode === 'transit' ? TRANSIT_ROUTE_CACHE_TTL_SECONDS : MAPS_RESULT_CACHE_TTL_SECONDS;
    return this.memoize(this.routes, key, 'route', () =>
      this.withSharedCache(['route', key], ttl, () => {
        this.usage.routeCalls++;
        return this.maps.route(origin, destination, { travelMode: this.travelMode });
      }),
    );
  }

  private async withSharedCache<T>(
    [kind, input]: [string, string],
    ttlSeconds: number,
    compute: () => Promise<T | null>,
  ): Promise<T | null> {
    const shared = this.sharedCache;
    if (!shared) return compute();
    const key = mapsCacheKey(shared.tenantId, kind, input);
    if (shared.read) {
      const cached = await shared.cache.get<CachedMapsResult<T>>(key);
      if (cached !== undefined) {
        this.usage.cacheHits++;
        return cached.value;
      }
    }
    const value = await compute();
    await shared.cache.set<CachedMapsResult<T>>(
      key,
      { value },
      value === null ? NOT_FOUND_CACHE_TTL_SECONDS : ttlSeconds,
    );
    return value;
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

/**
 * 共有キャッシュのキー。住所・座標(自宅の位置など個人に結びつく値)をキーにそのまま残さないよう
 * SHA-256 にする(Memorystore 等に差し替えてキーが外から見えるようになっても読めないように)。
 * 値の形を変えたら v を上げる(古い形を読ませないため。v2 = 見つからなかった結果も覚えるため `{ value }` で包んだ形)。
 */
export function mapsCacheKey(tenantId: string, kind: string, input: string): string {
  const digest = createHash('sha256').update(`${tenantId}\u0000${kind}\u0000${input}`).digest('hex');
  return `maps:v2:${kind}:${digest}`;
}
