/*
 * GAS版 index.html の中で google.script.run を置きかえるモック(ブラウザ側)。
 * 呼ばれた関数名と引数をハーネスのサーバー(POST /__gas/run/<関数名>)に送り、
 * 戻り値を withSuccessHandler に、例外を withFailureHandler に渡す(GAS版と同じく非同期)。
 *
 * 撮影スクリプト(Playwright)からは window.__GAS_MOCK__ で挙動を変えられる:
 *   delays:    { 関数名: ミリ秒 | 'never' }   応答までの時間('never' = 応答しない=読み込み中のまま)
 *   failures:  { 関数名: 'メッセージ' }        withFailureHandler に渡す
 *   overrides: { 関数名: 戻り値 }              サーバーに問い合わせずにこの値を返す
 *   defaultDelay: ミリ秒(既定 100)
 * 手で開くときは URL の ?as=admin|staff|none でログイン状態を選べる(src/serve.ts)。
 */
(() => {
  const params = new URLSearchParams(location.search);
  const as = params.get('as');
  if (as === 'admin' || as === 'staff') {
    localStorage.setItem('GAS_AUTH_TOKEN', as === 'admin' ? 'mock-token-admin' : 'mock-token-staff');
  } else if (as === 'none') {
    localStorage.removeItem('GAS_AUTH_TOKEN');
    localStorage.removeItem('GAS_STAFF_SESSION_V3');
    localStorage.removeItem('GAS_STAFF_ADMIN');
  }

  const localToday = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function call(name, args, onSuccess, onFailure, userObject) {
    const conf = window.__GAS_MOCK__ || {};
    const delay = conf.delays?.[name] ?? conf.defaultDelay ?? 100;
    if (delay === 'never') return;
    let outcome;
    if (conf.failures && name in conf.failures) {
      outcome = { error: conf.failures[name] };
    } else if (conf.overrides && name in conf.overrides) {
      outcome = { value: conf.overrides[name] };
    } else {
      try {
        const res = await fetch(`/__gas/run/${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ args, today: localToday() }),
        });
        outcome = await res.json();
      } catch (e) {
        outcome = { error: String(e) };
      }
    }
    await sleep(delay);
    if ('error' in outcome) {
      if (onFailure) onFailure(new Error(outcome.error), userObject);
      else console.error(`[gas-mock] ${name} failed:`, outcome.error);
      return;
    }
    if (onSuccess) onSuccess(outcome.value, userObject);
  }

  function runner(onSuccess, onFailure, userObject) {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'withSuccessHandler') return (fn) => runner(fn, onFailure, userObject);
          if (prop === 'withFailureHandler') return (fn) => runner(onSuccess, fn, userObject);
          if (prop === 'withUserObject') return (obj) => runner(onSuccess, onFailure, obj);
          if (typeof prop !== 'string') return undefined;
          return (...args) => {
            void call(prop, args, onSuccess, onFailure, userObject);
          };
        },
      },
    );
  }

  window.google = {
    script: {
      run: runner(null, null, undefined),
      host: { close() {}, setHeight() {}, setWidth() {}, editor: { focus() {} } },
      url: { getLocation: (cb) => cb({ hash: '', parameter: {}, parameters: {} }) },
    },
  };
})();
