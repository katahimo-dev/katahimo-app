import type { Config } from 'tailwindcss';

/**
 * GAS版(gas-childcare-visit-app/index.html)は Tailwind Play CDN(v3.4系・設定なし)を使っている。
 * 見た目を1pxまで揃えるため、同じv3系を既定テーマのまま使い、テーマの拡張は行わない
 * (色・余白・角丸などはGAS版と同じクラス名を書けば同じ値になる)。
 * フォントやルートの文字サイズなど、GAS版が<style>で独自に書いていた部分は src/styles/index.css にある。
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
