import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applyTextSizeToDocument, readStoredTextSize } from './lib/textSize';
import './styles/index.css';

// 描画前に文字の大きさを反映する(GAS版 window.onload の applyTextSize と同じ。古い保存値もここで正規化される)
applyTextSizeToDocument(readStoredTextSize());

const root = document.getElementById('root');
if (!root) throw new Error('#root が見つかりません');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
