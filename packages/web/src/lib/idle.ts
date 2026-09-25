/**
 * 手が空いたときに fn を動かす(requestIdleCallback。無いブラウザでは少し待ってから)。
 * 後で使う画面の部品(分割したJS)を先に読んでおくのに使う。戻り値で取り消せる。
 */
export function runWhenIdle(fn: () => void, timeoutMs = 2000): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(fn, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = setTimeout(fn, 200);
  return () => clearTimeout(timer);
}
