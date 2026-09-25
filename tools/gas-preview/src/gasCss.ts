import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

/**
 * GAS版は Tailwind Play CDN(cdn.tailwindcss.com、v3系・設定なし)で実行時にCSSを作っている。
 * この環境からCDNに届かないことがあり、また撮影のたびに結果が揺れないよう、同じv3系の
 * tailwindcss で GAS版 index.html の中身(マークアップとスクリプト内のクラス名)から
 * 同じCSSを事前に作って差しかえる(Play CDN も既定テーマ+preflightなので結果は同じになる)。
 */
export async function buildGasTailwindCss(html: string): Promise<string> {
  const result = await postcss([
    tailwindcss({ content: [{ raw: html, extension: 'html' }], theme: { extend: {} }, plugins: [] }),
  ]).process('@tailwind base;\n@tailwind components;\n@tailwind utilities;\n', { from: undefined });
  return result.css;
}
