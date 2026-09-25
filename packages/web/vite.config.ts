import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'katahimo 訪問管理',
        short_name: 'katahimo',
        description: '保育訪問業務の予定・訪問先・勤怠を管理するアプリ',
        lang: 'ja',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
      },
    }),
  ],
  server: {
    port: 5173,
    // 開発中はAPI(:8080)へプロキシし、本番と同じ同一オリジン構成(Cookie認証)にする
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
});
