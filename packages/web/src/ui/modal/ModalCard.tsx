import type { ReactNode } from 'react';

/**
 * GAS版で繰り返し使われている「灰色の見出し帯 + × ボタン」のダイアログ見出し
 * (設定・ヒント・お客様の情報・今月のまとめ 等)。
 *
 * ```html
 * <div class="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
 *   <h3 class="font-bold text-gray-800 text-base">設定</h3>
 *   <button class="min-h-11 px-3 py-2 active:bg-gray-200 rounded-full text-gray-600 text-base">&times;</button>
 * </div>
 * ```
 */
export function ModalHeader({
  title,
  onClose,
  titleClassName = 'font-bold text-gray-800 text-base',
  titleId,
}: {
  title: ReactNode;
  onClose: () => void;
  /** 見出しの文字のクラス(お客様の情報などは 'font-bold text-lg text-gray-800') */
  titleClassName?: string;
  titleId?: string;
}) {
  return (
    <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
      <h3 id={titleId} className={titleClassName}>
        {title}
      </h3>
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

/** GAS版の灰色のダイアログ下部(ボタン置き場)。className で並べ方(text-right / flex justify-end gap-3)を指定する。 */
export function ModalFooter({
  className = 'text-right',
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`p-4 border-t bg-gray-50 rounded-b-2xl ${className}`}>{children}</div>;
}
