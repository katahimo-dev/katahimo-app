import { Fragment } from 'react';
import { EmptyState, ErrorState, Loading } from '../../ui/StatusViews';
import { isCustomerEventType } from './eventTypes';
import { RouteLegRow } from './RouteLegRow';
import { ScheduleCard } from './ScheduleCard';
import type { ScheduleOffset } from './scheduleDate';
import type { ScheduleListState } from './useScheduleView';

/** 予定の一覧の中身(GAS版 #scheduleList の renderSchedule / renderScheduleWithRoute)。 */
export function ScheduleList({
  state,
  offset,
  onWriteReport,
}: {
  state: ScheduleListState;
  offset: ScheduleOffset;
  onWriteReport: (scheduleName: string) => void;
}) {
  if (state.kind === 'loading') return <Loading />;
  if (state.kind === 'error') return <ErrorState message={state.message} />;
  if (state.items.length === 0) return <ScheduleEmptyState offset={offset} />;

  return (
    <>
      {state.items.map((item, idx) => {
        // お客様の訪問以外(事務作業・イベント)は実在の訪問先ではないため、移動の地図ボタンは出さない
        const showMapButtons = isCustomerEventType(item.eventType);
        return (
          // 予定には一意なIDが無く、並び順が表示の単位のため添字をキーにする
          // biome-ignore lint/suspicious/noArrayIndexKey: 予定の並び順そのものが識別子
          <Fragment key={idx}>
            {item.legBefore ? <RouteLegRow leg={item.legBefore} showMapButtons={showMapButtons} /> : null}
            <ScheduleCard item={item} onWriteReport={onWriteReport} />
            {item.legAfter ? <RouteLegRow leg={item.legAfter} showMapButtons={showMapButtons} /> : null}
          </Fragment>
        );
      })}
    </>
  );
}

/** 予定が無い日(GAS版 scheduleEmptyStateHtml_。今日/明日で次にすることを出し分ける) */
function ScheduleEmptyState({ offset }: { offset: ScheduleOffset }) {
  return offset === 1 ? (
    <EmptyState icon="📭" title="明日の予定はありません" hint="今日の予定は上の「☀️ 今日」で見られます" />
  ) : (
    <EmptyState icon="📭" title="この日の予定はありません" hint="明日の予定は上の「🌙 明日」で見られます" />
  );
}
