import { useEffect, useState } from 'react';
import { AdminTargetStaffSelector, useAdminTargetStaff } from './AdminTargetStaffContext';
import type {
  DailyScheduleAppointmentWithRoute,
  DailyScheduleResult,
  DailyScheduleWithRouteResult,
} from './api';
import { fetchDailySchedule, fetchDailyScheduleWithRoute } from './api';

/** GAS版index.htmlのSCHEDULE_ROUTE_CACHE_PREFIX/TTLと同じ役割(ブラウザ内・2時間)。 */
const ROUTE_CACHE_PREFIX = 'katahimo_schedule_route_v1_';
const ROUTE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

const EVENT_TYPE_ICON: Record<string, string> = {
  'CUSTOMER APPOINTMENT': '📍',
  'OFFICE WORK': '📝',
  EVENT: '📅',
};
const EVENT_TYPE_BORDER: Record<string, string> = {
  'CUSTOMER APPOINTMENT': 'border-l-4 border-l-blue-400',
  'OFFICE WORK': 'border-l-4 border-l-gray-300',
  EVENT: 'border-l-4 border-l-teal-400',
};

function isCustomerEventType(eventType: string): boolean {
  return eventType === 'CUSTOMER APPOINTMENT';
}

function formatEventTypeLabel(eventType: string): string {
  if (eventType === 'CUSTOMER APPOINTMENT') return '顧客訪問';
  if (eventType === 'OFFICE WORK') return '事務作業';
  if (eventType === 'EVENT') return 'イベント';
  return eventType || '';
}

function dateStrForOffset(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('sv-SE'); // 'YYYY-MM-DD'
}

function routeCacheKey(staffCacheId: string, dateStr: string): string {
  return `${ROUTE_CACHE_PREFIX}${staffCacheId}_${dateStr}`;
}

interface CachedRoute {
  res: DailyScheduleWithRouteResult;
  ts: number;
}

function getCachedRoute(staffCacheId: string, dateStr: string): CachedRoute | null {
  try {
    const raw = localStorage.getItem(routeCacheKey(staffCacheId, dateStr));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRoute;
    if (!parsed?.ts || Date.now() - parsed.ts > ROUTE_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setCachedRoute(staffCacheId: string, dateStr: string, res: DailyScheduleWithRouteResult): void {
  try {
    localStorage.setItem(routeCacheKey(staffCacheId, dateStr), JSON.stringify({ res, ts: Date.now() }));
  } catch {
    // localStorage不可時は静かに無視(表示自体には影響しない)
  }
}

/** GAS版buildCurrentLocationMapsUrlと同じ、既存ルートURLの目的地座標だけを使って現在地起点のURLを作る。 */
function buildCurrentLocationMapsUrl(url: string): string {
  if (!url) return '';
  const m = url.match(/destination=(-?[0-9.]+),(-?[0-9.]+)/);
  if (!m) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${m[1]},${m[2]}&travelmode=driving`;
}

function RouteLeg({
  label,
  min,
  km,
  url,
}: {
  label: string;
  min: number | string;
  km: number | string;
  url: string;
}) {
  if (!km && !min) return null;
  const detail = [min ? `${min}分` : '', km ? `${km}km` : ''].filter(Boolean).join(' / ');
  const curUrl = buildCurrentLocationMapsUrl(url);
  return (
    <div className="bg-gray-50 rounded-lg p-2 mb-1">
      <div className="text-xs text-gray-600 font-bold mb-1.5 pl-1">
        🚗 {label}: {detail || '算出できません'}
      </div>
      <div className="flex gap-1.5">
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1 py-2.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200 active:bg-blue-100"
          >
            🗺️ 地図で見る
          </a>
        )}
        {curUrl && (
          <a
            href={curUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1 py-2.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200 active:bg-emerald-100"
          >
            📍 現在地から
          </a>
        )}
      </div>
    </div>
  );
}

function ScheduleSubtitle({ eventType, address }: { eventType: string; address: string }) {
  if (!isCustomerEventType(eventType)) {
    return <div className="text-xs text-gray-400 mt-0.5">{formatEventTypeLabel(eventType)}</div>;
  }
  if (!address) {
    return <div className="text-xs text-gray-400 mt-0.5">住所未登録</div>;
  }
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return (
    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
      <span className="text-xs text-gray-500 truncate">{address}</span>
      <a
        href={mapUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded hover:bg-blue-200"
      >
        Map
      </a>
    </div>
  );
}

function formatFetchedAt(ts: number): string {
  const t = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `取得時刻: ${t.getFullYear()}/${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/**
 * 「予定」タブ。GAS版index.htmlのtabSchedule(今日/明日トグル・ルート取得ボタン・予定カード一覧)と
 * 同じ見た目・操作感にしている。予定データ自体はGoogleカレンダーAPIを直接叩くのではなく、
 * gas-childcare-visit-appのWeb App(Bridge.js)を経由してGAS版RouteSearch.jsの既存関数
 * (カレンダー解析・ルート計算ロジックは本番で動いているものをそのまま使う)を呼び出す
 * (packages/core/src/ports/schedule.ts参照)。
 *
 * 管理者向け「対象スタッフ」セレクタは勤怠タブと共有(AdminTargetStaffContext)。
 */
export function ScheduleTab({ onJumpToCustomer }: { onJumpToCustomer: (customerName: string) => void }) {
  const { effectiveStaffId } = useAdminTargetStaff();
  const [offset, setOffset] = useState<0 | 1>(0);
  const dateStr = dateStrForOffset(offset);
  const staffCacheId = effectiveStaffId ?? 'self';

  const [lightResult, setLightResult] = useState<DailyScheduleResult | null>(null);
  const [routeResult, setRouteResult] = useState<DailyScheduleWithRouteResult | null>(null);
  const [routeFetchedAt, setRouteFetchedAt] = useState<number | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadLightSchedule = async () => {
    try {
      const res = await fetchDailySchedule(dateStr, effectiveStaffId);
      setLightResult(res);
      if (!res.success) setErrorMessage(res.message || '予定を取得できませんでした');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const loadRoute = async (forceRefresh: boolean) => {
    setLoadingRoute(true);
    setErrorMessage(null);
    try {
      const res = await fetchDailyScheduleWithRoute(dateStr, effectiveStaffId, forceRefresh);
      if (!res.success) {
        setErrorMessage(res.message || 'ルート取得に失敗しました');
        await loadLightSchedule();
        return;
      }
      setCachedRoute(staffCacheId, dateStr, res);
      setRouteResult(res);
      setRouteFetchedAt(Date.now());
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      await loadLightSchedule();
    } finally {
      setLoadingRoute(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadRoute/loadLightScheduleは日付・対象スタッフが変わるたびに作り直されるクロージャのため、依存に含めると無限ループになる
  useEffect(() => {
    setLightResult(null);
    setRouteResult(null);
    setRouteFetchedAt(null);
    setErrorMessage(null);
    setLoadingInitial(true);

    const cached = getCachedRoute(staffCacheId, dateStr);
    if (cached) {
      setRouteResult(cached.res);
      setRouteFetchedAt(cached.ts);
      setLoadingInitial(false);
      return;
    }

    // タブを開いた時点でルート・移動時間も自動取得する(ブラウザに2時間キャッシュされ、
    // 同一ブラウザでの再取得は抑制される)。失敗時はルートなしの予定一覧だけでも表示する
    // (GAS版loadScheduleForOffset_/loadRouteInfoと同じ)。
    void loadRoute(false).finally(() => setLoadingInitial(false));
  }, [dateStr, staffCacheId]);

  const routeAppointments = routeResult?.appointments;
  const lightAppointments = lightResult?.appointments;
  const hasRoute = !!routeAppointments;
  const appointments = routeAppointments ?? lightAppointments ?? null;

  const handleJump = (customerName: string) => {
    if (!isCustomerEventType) return;
    onJumpToCustomer(customerName);
  };

  return (
    <div>
      <AdminTargetStaffSelector />

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setOffset(0)}
          className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${
            offset === 0 ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
          }`}
        >
          ☀️ 今日
        </button>
        <button
          type="button"
          onClick={() => setOffset(1)}
          className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${
            offset === 1 ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'
          }`}
        >
          🌙 明日
        </button>
      </div>

      <button
        type="button"
        onClick={() => loadRoute(true)}
        disabled={loadingRoute}
        className="w-full mb-1 py-3 rounded-xl text-sm font-bold border border-blue-200 bg-blue-50 text-blue-700 active:bg-blue-100 transition-colors flex items-center justify-center gap-1 disabled:opacity-60"
      >
        {loadingRoute
          ? '取得中...(数秒かかります)'
          : hasRoute
            ? '🔄 ルート・移動時間を再取得'
            : '🚗 ルート・移動時間を取得'}
      </button>
      <div className="text-[10px] text-gray-400 mb-3 text-center min-h-[1rem]">
        {routeFetchedAt ? formatFetchedAt(routeFetchedAt) : ''}
      </div>

      {loadingInitial && (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
        </div>
      )}

      {!loadingInitial && errorMessage && !appointments && (
        <div className="text-center text-red-500 text-sm py-8">{errorMessage}</div>
      )}

      {!loadingInitial && appointments && appointments.length === 0 && (
        <div className="text-center text-gray-400 text-sm py-8">この日の予定はありません</div>
      )}

      {!loadingInitial && appointments && appointments.length > 0 && (
        <div className="space-y-3">
          {appointments.map((app, idx) => {
            const withRoute = app as Partial<DailyScheduleAppointmentWithRoute>;
            const title = hasRoute ? withRoute.customerName : (app as { title?: string }).title;
            const start = hasRoute ? withRoute.startTime : (app as { start?: string }).start;
            const end = hasRoute ? withRoute.endTime : (app as { end?: string }).end;
            const clickable = isCustomerEventType(app.eventType);
            const hasAttendanceLeg = !!(
              withRoute.attendanceMin ||
              withRoute.attendanceKm ||
              withRoute.attendanceUrl
            );

            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: カレンダー予定由来のデータで安定したID(顧客IDは無い場合もある)が無いため、GAS版のdata-appt-idxと同じくindexを使う
              <div key={`${idx}-${title}`}>
                {hasRoute &&
                  (hasAttendanceLeg ? (
                    <RouteLeg
                      label="出勤"
                      min={withRoute.attendanceMin ?? ''}
                      km={withRoute.attendanceKm ?? ''}
                      url={withRoute.attendanceUrl ?? ''}
                    />
                  ) : (
                    <RouteLeg
                      label="移動"
                      min={withRoute.moveMin ?? ''}
                      km={withRoute.moveKm ?? ''}
                      url={withRoute.moveUrl ?? ''}
                    />
                  ))}

                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && handleJump(title || '')}
                  className={`w-full text-left rounded-xl shadow-sm border border-gray-100 ${
                    EVENT_TYPE_BORDER[app.eventType] || ''
                  } p-3 flex items-center gap-3 transition-colors ${
                    clickable ? 'bg-white hover:bg-blue-50' : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex-shrink-0 text-center w-16">
                    <div className={`text-sm font-bold ${clickable ? 'text-gray-800' : 'text-gray-500'}`}>
                      {start || ''}
                    </div>
                    <div className="text-[10px] text-gray-400">〜{end || ''}</div>
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-sm leading-none flex-shrink-0">
                        {EVENT_TYPE_ICON[app.eventType] || '🕒'}
                      </span>
                      <span className={`font-bold truncate ${clickable ? 'text-gray-800' : 'text-gray-600'}`}>
                        {title || '(名称未設定)'}
                      </span>
                    </div>
                    <ScheduleSubtitle eventType={app.eventType} address={app.address || ''} />
                  </div>
                </button>

                {hasRoute && (withRoute.leavingMin || withRoute.leavingKm || withRoute.leavingUrl) && (
                  <RouteLeg
                    label="退勤"
                    min={withRoute.leavingMin ?? ''}
                    km={withRoute.leavingKm ?? ''}
                    url={withRoute.leavingUrl ?? ''}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
