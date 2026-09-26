import { fileURLToPath } from 'node:url';

// GAS版はTailwind Play CDN(v3)をそのまま使っており、autoprefixerは通していない。
// 見た目を揃えるため、こちらもtailwindcss(v3)だけを通す。
// 設定ファイルは場所で指定する(通し確認の tools/e2e(src/webServer.ts)が別のフォルダから Vite を起動しても同じ設定を読むように)。
export default {
  plugins: {
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.ts', import.meta.url)) },
  },
};
