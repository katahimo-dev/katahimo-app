// GAS版はTailwind Play CDN(v3)をそのまま使っており、autoprefixerは通していない。
// 見た目を揃えるため、こちらもtailwindcss(v3)だけを通す。
export default {
  plugins: {
    tailwindcss: {},
  },
};
