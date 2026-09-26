/**
 * ダウンロードした中身をファイルとして保存する(一時的なリンクを押す)。リンクの URL は少し待ってから捨てる
 * (すぐ捨てると保存が始まる前に消える端末があるため)。
 */
export function saveBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
