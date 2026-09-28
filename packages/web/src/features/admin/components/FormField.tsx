import type { ReactNode } from 'react';

/**
 * 管理タブの入力欄・ボタン。管理タブは管理者・コーディネーターが使う画面なので、スタッフの画面(大きめの押しやすい
 * ボタン)より小さくして、一覧・表を一度に多く見せる。
 */
export const INPUT_CLASS =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-600';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1 min-h-9 px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap disabled:opacity-50';
/** 主な操作(保存・登録・反映)。 */
export const PRIMARY_BUTTON = `${BUTTON_BASE} bg-blue-600 text-white hover:bg-blue-700`;
/** そのほかの操作(読み込み直す・書き出す・やめる)。 */
export const SECONDARY_BUTTON = `${BUTTON_BASE} bg-white text-gray-800 border border-gray-300 hover:bg-gray-50`;
/** 行の中のアイコンだけのボタン(aria-label を必ず付ける)。 */
export const ICON_BUTTON =
  'inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-lg text-base text-gray-700 hover:bg-gray-100 disabled:opacity-40';
/** 白いカードの枠。 */
export const CARD_CLASS = 'bg-white p-3 rounded-xl border border-gray-200';

/**
 * ラベル・入力欄・説明・誤りの文言のまとまり。入力欄は children(id を htmlFor と合わせる)。
 * 誤りの文言は `${id}-error` の id で出すので、入力欄の aria-describedby / aria-invalid に使う(fieldA11y)。
 */
export function FormField({
  id,
  label,
  required = false,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-bold text-gray-700 mb-1">
        {label}
        {required ? <span className="text-red-600 ml-1">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-gray-600 mt-1">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-600 mt-1">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** 入力欄に付ける読み上げ用の属性(誤りがあるときだけ)。 */
export function fieldA11y(id: string, error: string | undefined) {
  return error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {};
}
