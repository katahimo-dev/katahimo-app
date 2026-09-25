import type { StaffRouteProfileRecord, StaffRouteProfileRepositoryPort } from '@katahimo/core/ports';
import type { Database } from '../client';
import { withTenant } from '../client';
import { staff } from '../schema';

/**
 * 予定・ルート計算用のスタッフ属性(自宅・移動手段・カレンダーID)の読み取り。
 * 認証用の StaffRecord(staffRepository.ts)とは用途が違うため別のリポジトリにしている。
 *
 * 自宅住所の文字列はstaffテーブルに専用列が無いため custom_fields.homeAddress から読む
 * (スキーマ凍結中の暫定。doc/api/schedule-route.md)。
 */
export class DrizzleStaffRouteProfileRepository implements StaffRouteProfileRepositoryPort {
  constructor(private readonly db: Database) {}

  async listByTenant(tenantId: string): Promise<StaffRouteProfileRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: staff.id,
          name: staff.name,
          customFields: staff.customFields,
          homeLatLngCiphertext: staff.homeLatLngCiphertext,
          homeLatLngKeyVersion: staff.homeLatLngKeyVersion,
          travelMode: staff.travelMode,
          calendarId: staff.calendarId,
          retirementDate: staff.retirementDate,
        })
        .from(staff);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        homeAddress: readHomeAddress(row.customFields),
        homeLatLng:
          row.homeLatLngCiphertext && row.homeLatLngKeyVersion != null
            ? { ciphertext: row.homeLatLngCiphertext, keyVersion: row.homeLatLngKeyVersion }
            : null,
        travelMode: row.travelMode,
        calendarId: row.calendarId,
        retirementDate: row.retirementDate,
      }));
    });
  }
}

function readHomeAddress(customFields: Record<string, unknown>): string | null {
  const value = customFields.homeAddress;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
