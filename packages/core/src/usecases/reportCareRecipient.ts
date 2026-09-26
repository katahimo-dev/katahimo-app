import { invalid } from '../domain';
import type { CareRecipientRecord } from '../ports/customers';
import type { TenantRepositories } from '../ports/unitOfWork';

/**
 * 日報の対象のお子様を決める(日報AIの生成と日報の保存で同じ決め方)。
 * - ID の指定: お客様の世帯の子か確かめる(アーカイブされた子も、前に書いた日報の上書きのため認める)。違えば 400。
 * - null: 選ばない(画面の「選ばない」)。
 * - 省略: 世帯にアーカイブされていない子がちょうど1人ならその子(画面の自動選択と同じ)。それ以外は選ばない。
 */
export async function resolveReportCareRecipient(
  r: TenantRepositories,
  customerId: string,
  careRecipientId: string | null | undefined,
): Promise<CareRecipientRecord | null> {
  if (careRecipientId === null) return null;
  if (careRecipientId === undefined) {
    const active = await r.careRecipients.listByCustomer(customerId);
    return active.length === 1 ? (active[0] ?? null) : null;
  }
  const recipients = await r.careRecipients.listByCustomer(customerId, { includeArchived: true });
  const recipient = recipients.find((c) => c.id === careRecipientId);
  if (!recipient) {
    throw invalid(
      '対象のお子様がこのお客様の世帯にいません。画面を開きなおしてください',
      { careRecipientId: '対象のお子様が正しくありません' },
      'care_recipient_mismatch',
    );
  }
  return recipient;
}
