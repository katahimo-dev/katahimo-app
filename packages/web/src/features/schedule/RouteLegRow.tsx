import { isGoogleMapsUrl } from '@katahimo/shared';
import type { RouteLeg } from './scheduleItems';

/**
 * 移動の1区間(GAS版 formatRouteLeg)。「🏠 家から 18分（6.2km）」と、道順を開くボタン。
 * ボタンは淡い色にして、カードの中で濃い青の主ボタンは「✏️ この訪問の日報を書く」だけにする。
 */
export function RouteLegRow({ leg, showMapButtons }: { leg: RouteLeg; showMapButtons: boolean }) {
  return (
    <div className="bg-gray-50 rounded-xl p-2 mb-1">
      <div className="text-base text-gray-700 font-bold mb-1.5 pl-1">
        {leg.label} {leg.detail}
      </div>
      <div className="flex gap-3">
        {/* 道順のリンクは Google マップの https の URL だけ(契約でも '' にしているが、画面でも確かめる) */}
        {showMapButtons && leg.directionsUrl && isGoogleMapsUrl(leg.directionsUrl) ? (
          <a
            href={leg.directionsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 min-h-12 inline-flex items-center justify-center gap-1 py-3 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 text-sm font-bold"
          >
            🗺️ 道順を見る
          </a>
        ) : null}
        {showMapButtons && leg.currentLocationUrl ? (
          <a
            href={leg.currentLocationUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 min-h-12 inline-flex items-center justify-center gap-1 py-3 rounded-xl bg-green-50 text-green-700 border border-green-200 text-sm font-bold"
          >
            📍 今いる場所から
          </a>
        ) : null}
      </div>
    </div>
  );
}
