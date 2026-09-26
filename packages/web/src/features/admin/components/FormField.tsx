import type { ReactNode } from 'react';

export const INPUT_CLASS =
  'w-full p-3 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-600';

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
      <label htmlFor={id} className="block text-sm font-bold text-gray-700 mb-1">
        {label}
        {required ? <span className="text-red-600 ml-1">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-sm text-gray-600 mt-1">{hint}</p> : null}
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
