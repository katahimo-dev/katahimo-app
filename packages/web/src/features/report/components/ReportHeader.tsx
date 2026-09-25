import { cx } from './cx';

interface ReportHeaderProps {
  title: string;
  subtitle: string;
  /** お客様の指定なしの領収書のとき、お客様の名前を書く欄を出す */
  showUnregisteredName: boolean;
  unregisteredName: string;
  onUnregisteredNameChange: (value: string) => void;
  onClose: () => void;
}

/** ダイアログの見出し(お客様の名前・住所と ×)。GAS版 #reportModal の Modal Header。 */
export function ReportHeader({
  title,
  subtitle,
  showUnregisteredName,
  unregisteredName,
  onUnregisteredNameChange,
  onClose,
}: ReportHeaderProps) {
  return (
    <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
      <div>
        <h2 className="font-bold text-lg text-gray-800" id="modalCustomerName">
          {title}
        </h2>
        <p className="text-sm text-gray-600" id="modalCustomerAddress">
          {subtitle}
        </p>
        <input
          type="text"
          id="unregisteredCustomerName"
          aria-label="お客様の名前"
          value={unregisteredName}
          onChange={(e) => onUnregisteredNameChange(e.target.value)}
          className={cx(
            !showUnregisteredName && 'hidden',
            'w-full mt-2 p-3 border border-gray-300 rounded-xl text-base',
          )}
          placeholder="お客様の名前（登録がないとき。なければ空欄でOK）"
        />
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="min-h-11 px-3 py-2 active:bg-gray-200 rounded-full text-gray-600 text-base"
      >
        &times;
      </button>
    </div>
  );
}
