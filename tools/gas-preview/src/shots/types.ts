import type { Page } from 'playwright-core';
import type { WebMockOverrides } from '../webMock';

/**
 * 撮影する場面の定義。GAS版(gas)と新アプリ(web)を同じ条件で開き、同じ操作をしてから撮る。
 * 文言がGAS版と同じなら、操作(run)は getByRole('button', { name: '⚙️ 設定' }) のような
 * 文言ベースの指定で両方に共通で書ける。違う操作が必要なときだけ gas / web 側に run を書く。
 */
export type Target = 'gas' | 'web';

/** GAS版のモックの挙動(browser/google-script-run-mock.js の window.__GAS_MOCK__) */
export interface GasMockConfig {
  delays?: Record<string, number | 'never'>;
  failures?: Record<string, string>;
  overrides?: Record<string, unknown>;
  defaultDelay?: number;
}

export interface TargetOptions {
  /** この対象だけの操作(共通の run の代わりに実行する) */
  run?: (page: Page) => Promise<void>;
  /** 撮影時に消す部分(まだ作っていない画面など、見比べない部分)の CSS セレクタ。visibility: hidden にする */
  hide?: string[];
  /** 撮影時に塗りつぶす部分(時刻など、毎回変わる部分)の CSS セレクタ */
  mask?: string[];
  /** false にするとこの対象は撮らない */
  enabled?: boolean;
}

export interface Shot {
  /** ファイル名(out/<name>.png) */
  name: string;
  /** 何の場面か(日本語) */
  title: string;
  /** ログイン状態(既定 admin) */
  login?: 'admin' | 'staff' | 'none';
  /** 文字の大きさ(localStorage app_text_size。既定 normal) */
  textSize?: 'normal' | 'large' | 'xlarge';
  /** ページ全体を撮る(既定は画面の大きさだけ) */
  fullPage?: boolean;
  /** 両方で行う操作 */
  run?: (page: Page, target: Target) => Promise<void>;
  gas?: TargetOptions & { mock?: GasMockConfig };
  web?: TargetOptions & { mock?: WebMockOverrides };
}

/** 見えている要素だけに絞る(GAS版は閉じたダイアログもDOMに残っているため)。 */
export const visible = { visible: true } as const;
