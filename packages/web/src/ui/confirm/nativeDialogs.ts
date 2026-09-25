/**
 * ブラウザ標準の confirm() / alert()。GAS版は場所によって標準ダイアログを使っている
 * (例: 「ログアウトしますか？」「この予定の内容を消します。よろしいですか？」
 * 「事務局に「訪問終わりました」を送りますか？」「パスワードを変更しました」)。
 * GAS版で標準ダイアログを使っている場所はこちらを、独自のダイアログ(#confirmationModal)を
 * 使っている場所は useConfirmModal() を使う(見た目・操作感をGAS版と同じにするため)。
 */
export function confirmNative(message: string): boolean {
  return window.confirm(message);
}

export function alertNative(message: string): void {
  window.alert(message);
}
