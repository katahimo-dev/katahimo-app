import type { TestContext } from '../testContext';
import { createTestContext } from '../testContext';

/** 認証系テスト共通の依存一式(全てインメモリ)。 */
export type AuthTestContext = TestContext;

export async function createAuthTestContext(): Promise<AuthTestContext> {
  return createTestContext();
}
