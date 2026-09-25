/**
 * 顧客データの版数の変化を見張る(GAS版 localDataVersion と checkForUpdates の比較部分)。
 * 最初に受け取った版数は基準として覚えるだけにし、2回目以降に違う値が来たら「変わった」とする。
 * (GAS版は顧客一覧の応答に含まれる版数を基準にしていた。新APIの顧客一覧には版数が無いため、
 * ログイン直後の1回目のポーリング結果を基準にする)
 */
export type VersionObservation = 'baseline' | 'unchanged' | 'changed';

export function createVersionWatcher() {
  let known: string | null = null;
  return {
    observe(version: string): VersionObservation {
      if (!version) return 'unchanged';
      if (known === null) {
        known = version;
        return 'baseline';
      }
      if (version === known) return 'unchanged';
      known = version;
      return 'changed';
    },
  };
}
