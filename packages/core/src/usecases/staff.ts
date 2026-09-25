import type { StaffRepositoryPort } from '../ports/repositories';

export interface StaffDeps {
  staff: StaffRepositoryPort;
}

export interface ActiveStaffView {
  id: string;
  name: string;
}

/**
 * 管理者向け「対象スタッフ」一覧(退職済みは除く)。GAS版PastSchedule.js
 * getActiveStaffNamesForAdminに対応。呼び出し元のAPIルートで管理者権限チェックを行う
 * (管理者以外はここを呼ばず空配列を返す)。
 *
 * 並び替えはGAS版の`names.sort()`(ロケール非依存の単純な文字列比較)と同じ挙動にする。
 */
export async function listActiveStaffForAdmin(deps: StaffDeps, tenantId: string): Promise<ActiveStaffView[]> {
  const rows = await deps.staff.listActive(tenantId);
  return rows
    .map((r) => ({ id: r.id, name: r.name }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
