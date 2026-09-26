import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** tools/e2e */
export const TOOL_ROOT = resolve(here, '..');
/** リポジトリのルート */
export const REPO_ROOT = resolve(TOOL_ROOT, '../..');
/** 通し確認で撮った画面の置き場所(.gitignore 済み) */
export const OUT_DIR = resolve(TOOL_ROOT, 'out');
