import type { Tx } from '../../client';

/** UoW のトランザクションとテナントに結び付いたリポジトリの共通部分。 */
export abstract class TenantBound {
  constructor(
    protected readonly tx: Tx,
    protected readonly tenantId: string,
  ) {}
}
