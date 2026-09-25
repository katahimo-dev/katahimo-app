import { loadDotenv } from './loadDotenv';

loadDotenv();

import { getDatabase } from './client';

// Phase 1 でテナント・管理者スタッフ・プロンプト初期値の投入を実装する。
const db = getDatabase();
void db;
console.log('シードは Phase 1 で実装します');
process.exit(0);
