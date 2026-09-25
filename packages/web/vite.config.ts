import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: {
    // 設定画面の「Ver. x.y.z」(GAS版は手書きの版数だった)
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '保育日報アプリ',
        short_name: '保育日報',
        description: '保育訪問の予定・お客様・出勤簿・日報を扱うスタッフ用アプリ',
        lang: 'ja',
        theme_color: '#2563eb',
        background_color: '#f3f4f6',
        display: 'standalone',
        start_url: '/',
      },
    }),
  ],
  server: {
    // 並行して別のAPI・画面を動かすときは環境変数で変える(例: WEB_DEV_PORT=5311 WEB_API_PROXY_TARGET=http://localhost:8511)
    port: Number(process.env.WEB_DEV_PORT ?? 5173),
    // 開発中はAPI(:8080)へプロキシし、本番と同じ同一オリジン構成(Cookie認証)にする
    proxy: {
      '/api': { target: process.env.WEB_API_PROXY_TARGET ?? 'http://localhost:8080', changeOrigin: true },
    },
  },
});
