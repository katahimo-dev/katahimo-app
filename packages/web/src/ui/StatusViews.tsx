import type { ReactNode } from 'react';
import { LOADING_MESSAGE } from '../lib/messages';

/**
 * 読み込み中の表示(GAS版 SCHEDULE_LOADING_HTML_ / customerList の初期表示と同じ)。
 * スピナーだけだと何が起きているか分からないため文字も添える。
 */
export function Loading({ message = LOADING_MESSAGE }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
      <div className="text-base text-gray-600">{message}</div>
    </div>
  );
}

/**
 * データが無いときのお知らせ(GAS版 scheduleEmptyStateHtml_ / renderCustomers の0件表示と同じ形)。
 * 例: `<EmptyState icon="📭" title="この日の予定はありません" hint="明日の予定は上の「🌙 明日」で見られます" />`
 */
export function EmptyState({ icon, title, hint }: { icon: string; title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="text-center py-8">
      <div className="text-4xl mb-2">{icon}</div>
      <div className="text-base text-gray-700">{title}</div>
      {hint ? <div className="text-sm text-gray-600 mt-1">{hint}</div> : null}
    </div>
  );
}

/** 一覧の読み込みに失敗したときの赤い文言(GAS版 '<div class="text-center text-red-600 text-base py-8">')。 */
export function ErrorState({ message }: { message: ReactNode }) {
  return <div className="text-center text-red-600 text-base py-8">{message}</div>;
}
