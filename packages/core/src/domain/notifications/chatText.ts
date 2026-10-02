/**
 * Google Chat の文(text)に入れる利用者の入力・DB の値を、Chat の書式として読まれないようにする。
 * Chat は text の中の `<users/all>`(全員へのメンション)・`<https://…|文字>`(リンク)を書式として扱うため、
 * 名前・店名・本文などに `<` `>` を含めると、全員への通知や偽のリンクを差し込める。`&` `<` `>` を HTML の文字参照
 * (`&amp;` `&lt;` `&gt;`。Chat はそのまま `&` `<` `>` と表示する)にする。見出し・区切りなどアプリが書く部分には使わない。
 */
export function escapeChatText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
