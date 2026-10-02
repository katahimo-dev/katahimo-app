import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { DEMO_BANNER_LINK, type DemoTermsValues, demoBannerText, demoTermsValuesOf } from '../../../lib/demo';
import { DemoTermsModal } from './DemoTermsModal';
import { useDemoConfig } from './useDemoConfig';

interface DemoTermsContextValue {
  /** 注釈を開き直す(画面上の帯から) */
  reopen: () => void;
  /** 文言に入れる API の値(読めなければ null) */
  values: DemoTermsValues | null;
}

const DemoTermsContext = createContext<DemoTermsContextValue | null>(null);

/**
 * 公開デモの注釈の置き場所(デモ用テナントにログインしているときだけ AuthGate が置く)。
 * `showOnMount` はログインの画面からログインした直後だけ true にする。デモ用アカウントは共有で、ログインのたびに
 * 別の人かもしれないので、「見た」ことは覚えておかない(ページを読み込み直しただけ = 同じ人なら出さない)。
 */
export function DemoTermsProvider({ showOnMount, children }: { showOnMount: boolean; children: ReactNode }) {
  const { config } = useDemoConfig();
  // afterLogin は閉じても変えない(消えていく間にボタンの文言が変わらないように)
  const [state, setState] = useState({ open: showOnMount, afterLogin: showOnMount });
  const reopen = useCallback(() => setState({ open: true, afterLogin: false }), []);
  const values = demoTermsValuesOf(config);
  const value = useMemo(() => ({ reopen, values }), [reopen, values]);
  return (
    <DemoTermsContext value={value}>
      {children}
      <DemoTermsModal
        open={state.open}
        afterLogin={state.afterLogin}
        values={values}
        onClose={() => setState((s) => ({ ...s, open: false }))}
      />
    </DemoTermsContext>
  );
}

/**
 * 画面上の「デモ環境」の帯(AppShell。デモ用テナントにログインしているときだけ)。押すと注釈を開き直す。
 * DemoTermsProvider の外では何も出さない。
 */
export function DemoBanner() {
  const context = useContext(DemoTermsContext);
  if (!context) return null;
  return (
    <button
      type="button"
      onClick={context.reopen}
      className="w-full bg-amber-100 text-amber-900 text-xs text-center px-3 py-1"
    >
      {demoBannerText(context.values)} <span className="underline font-bold">{DEMO_BANNER_LINK}</span>
    </button>
  );
}
