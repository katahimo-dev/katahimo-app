import type { TenantDirectoryPort } from '@katahimo/core/ports';
import type { GasBridgeOptions } from './gasBridgeClient';

/** GAS Bridge に関わる環境変数(api/worker の env から渡す)。 */
export interface GasBridgeEnv {
  GAS_BRIDGE_URL?: string | undefined;
  GAS_BRIDGE_SECRET?: string | undefined;
  /** Bridge の持ち主のテナントの slug(GAS版を使っている法人。予定の取得・ミラーはこのテナントだけ)。 */
  GAS_BRIDGE_TENANT?: string | undefined;
  MIRROR_TO_GOOGLE_SHEETS?: boolean | undefined;
  SCHEDULE_PROVIDER?: string | undefined;
}

export interface GasBridgeConfig extends GasBridgeOptions {
  tenantSlug: string;
}

/** 3つ揃っていれば Bridge の設定(揃っていなければ null。揃っていない設定は gasBridgeEnvProblems が起動時に落とす)。 */
export function gasBridgeConfigOf(env: GasBridgeEnv): GasBridgeConfig | null {
  return env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET && env.GAS_BRIDGE_TENANT
    ? { baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET, tenantSlug: env.GAS_BRIDGE_TENANT }
    : null;
}

/**
 * 起動時の設定検証。Bridge は1つのテナントの GAS・スプレッドシートにつながっているため、URL・シークレットと
 * 持ち主のテナントは必ず一緒に設定する(テナントの無い Bridge を、どのテナントにも使わせない)。
 * ミラー・SCHEDULE_PROVIDER=gas_bridge は Bridge の設定が揃っていることが前提。
 */
export function gasBridgeEnvProblems(env: GasBridgeEnv): string[] {
  const values = [env.GAS_BRIDGE_URL, env.GAS_BRIDGE_SECRET, env.GAS_BRIDGE_TENANT];
  const complete = values.every(Boolean);
  const problems: string[] = [];
  if (!complete && values.some(Boolean)) {
    problems.push('  - GAS_BRIDGE_URL・GAS_BRIDGE_SECRET・GAS_BRIDGE_TENANT は3つ揃えて設定してください');
  }
  if (env.MIRROR_TO_GOOGLE_SHEETS && !complete) {
    problems.push(
      '  - MIRROR_TO_GOOGLE_SHEETS=true には GAS_BRIDGE_URL・GAS_BRIDGE_SECRET・GAS_BRIDGE_TENANT(ミラーするテナントの slug)が必要です',
    );
  }
  if (env.SCHEDULE_PROVIDER === 'gas_bridge' && !complete) {
    problems.push(
      '  - SCHEDULE_PROVIDER=gas_bridge には GAS_BRIDGE_URL・GAS_BRIDGE_SECRET・GAS_BRIDGE_TENANT が必要です',
    );
  }
  return problems;
}

/**
 * Bridge を使ってよいテナントか(持ち主のテナントだけ)。テナントの ID から slug を引いて比べ、合ったテナントの ID は
 * 覚えておく(slug は変わらないため、2回目からは DB を読まない)。
 */
export class GasBridgeTenantGuard {
  private allowedTenantId: string | null = null;

  constructor(
    readonly tenantSlug: string,
    private readonly tenants: Pick<TenantDirectoryPort, 'findById'>,
  ) {}

  async isAllowed(tenantId: string): Promise<boolean> {
    if (tenantId === this.allowedTenantId) return true;
    const tenant = await this.tenants.findById(tenantId);
    if (tenant?.slug !== this.tenantSlug) return false;
    this.allowedTenantId = tenant.id;
    return true;
  }

  /** 持ち主のテナント以外(テナントの指定が無い呼び出しを含む)は例外にする。 */
  async assertAllowed(tenantId: string | undefined): Promise<void> {
    if (tenantId && (await this.isAllowed(tenantId))) return;
    throw new Error(
      `GAS Bridge はテナント ${this.tenantSlug} の GAS版につながっているため、このテナントには使えません`,
    );
  }
}
