import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { useTodayJst } from '../../lib/useTodayJst';

/** 期間の絞り込み('YYYY-MM-DD'。空は undefined) */
export interface DateRangeFilters {
  from?: string;
  to?: string;
}

/**
 * 期間が「前の今日」の既定のまま(自分で変えていない)なら、今日の既定の期間にする。変えていればそのまま
 * (同じ値を返す)。期間以外の絞り込みはそのまま残す。
 */
export function followDefaultRange<T extends DateRangeFilters>(
  filters: T,
  previousDefault: Required<DateRangeFilters>,
  nextDefault: Required<DateRangeFilters>,
): T {
  if (filters.from !== previousDefault.from || filters.to !== previousDefault.to) return filters;
  return { ...filters, from: nextDefault.from, to: nextDefault.to };
}

/**
 * 管理タブの一覧の既定の期間(「今日」まで)を、開いたまま日付をまたいでも今日に合わせる。
 * タブは一度開くと隠すだけで残るため、開いた日の期間のまま前の日で終わる一覧を出し続けないように。
 * 入力中の条件(form)と一覧に使っている条件(applied)の両方を、期間を自分で変えていないときだけ動かす。
 */
export function useFollowDefaultRange<T extends DateRangeFilters>(
  defaultRangeFor: (today: string) => Required<DateRangeFilters>,
  setForm: Dispatch<SetStateAction<T>>,
  setApplied: Dispatch<SetStateAction<T>>,
): void {
  const today = useTodayJst();
  const [followedToday, setFollowedToday] = useState(today);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付が変わったときだけ動かす(defaultRangeFor は毎回同じ計算)
  useEffect(() => {
    if (today <= followedToday) return;
    const previous = defaultRangeFor(followedToday);
    const next = defaultRangeFor(today);
    setForm((f) => followDefaultRange(f, previous, next));
    setApplied((f) => followDefaultRange(f, previous, next));
    setFollowedToday(today);
  }, [today, followedToday]);
}
