import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTextSize, getStoredTextSize } from './settings/textSize';

applyTextSize(getStoredTextSize());

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 現場はモバイル回線のため、再フォーカスのたびの再取得は行わない
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root が見つかりません');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
