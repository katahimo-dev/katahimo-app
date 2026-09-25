import { TEXT_SIZE_LABELS } from '../lib/textSize';
import { useTextSize } from './TextSizeProvider';

/** GAS版の<header>。「Aa」ボタンは押すたびに文字の大きさを切り替え、今の大きさの名前を出す。 */
export function Header({ userName, onOpenSettings }: { userName: string; onOpenSettings: () => void }) {
  const { textSize, cycleTextSize } = useTextSize();
  return (
    <header className="bg-blue-600 text-white p-3 shadow-md z-10 sticky top-0 flex items-center justify-between gap-2">
      <h1 className="text-xl font-bold tracking-wider flex-shrink-0">保育日報</h1>
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm font-bold opacity-90 truncate min-w-0">{userName} さん</span>
        {/* アイコンだけのボタンは分かりにくいため、文字つきボタンにしている(GAS版と同じ) */}
        <button
          type="button"
          onClick={cycleTextSize}
          className="min-h-11 px-2 py-2 bg-white/20 rounded-xl text-sm font-bold whitespace-nowrap flex-shrink-0"
        >
          Aa {TEXT_SIZE_LABELS[textSize]}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="min-h-11 px-2 py-2 bg-white/20 rounded-xl text-sm font-bold whitespace-nowrap flex-shrink-0"
        >
          ⚙️ 設定
        </button>
      </div>
    </header>
  );
}
