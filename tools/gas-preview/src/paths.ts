import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** tools/gas-preview */
export const TOOL_ROOT = resolve(here, '..');
/** リポジトリのルート */
export const REPO_ROOT = resolve(TOOL_ROOT, '../..');
/** GAS版のソース(git submodule。読み取り専用) */
export const GAS_APP_DIR = resolve(REPO_ROOT, 'legacy/gas-childcare-visit-app/gas-childcare-visit-app');
export const GAS_INDEX_HTML = resolve(GAS_APP_DIR, 'index.html');
/** 撮影結果の置き場所(.gitignore 済み) */
export const OUT_DIR = resolve(TOOL_ROOT, 'out');
