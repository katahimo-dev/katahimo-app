import { LOADING_MESSAGE } from '../../../lib/messages';

/**
 * 「読み込んでいます…」(ui/StatusViews の Loading と同じ形で、上下の余白だけGAS版の場所ごとに違う:
 * 週間予定 py-10、予定の修正・今月のまとめ py-6、1日表示 py-8)。
 */
export function LoadingBlock({ padding }: { padding: 'py-6' | 'py-8' | 'py-10' }) {
  return (
    <div className={`flex flex-col items-center justify-center ${padding} gap-2`}>
      <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
      <div className="text-base text-gray-600">{LOADING_MESSAGE}</div>
    </div>
  );
}
