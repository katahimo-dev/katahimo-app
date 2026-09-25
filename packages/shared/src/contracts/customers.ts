import { z } from 'zod';
import { idSchema } from './common';

/** 世帯構成員(顧客詳細の一部)。allergyが空/nullの場合、UIは「アレルギー: なし」と表示する(GAS版と同じ)。 */
export const familyMemberViewSchema = z.object({
  id: idSchema,
  name: z.string(),
  dob: z.string().nullable(),
  info: z.string().nullable(),
  allergy: z.string().nullable(),
});
export type FamilyMemberView = z.infer<typeof familyMemberViewSchema>;

const nullableString = z.string().nullable();

/** GET /api/customers/:id のcustomer。 */
export const customerDetailViewSchema = z.object({
  id: idSchema,
  externalSource: nullableString,
  externalId: nullableString,
  name: z.string(),
  familyNameKana: nullableString,
  givenNameKana: nullableString,
  email: nullableString,
  phone: nullableString,
  addressDetail: nullableString,
  city: nullableString,
  parkingArea: nullableString,
  parkingDetail: nullableString,
  emergencyContact: nullableString,
  emergencyContactRelation: nullableString,
  evacuationSite: nullableString,
  memo: nullableString,
  benefitMemberId: nullableString,
  address2: nullableString,
  address2StartDate: nullableString,
  address2EndDate: nullableString,
  latLng: nullableString,
  memberType: nullableString,
  memberStatus: nullableString,
  paymentMethod: nullableString,
  paymentStatus: nullableString,
  gender: nullableString,
  ageBracket: nullableString,
  registeredAt: nullableString,
  externalLastUpdatedAt: nullableString,
  deactivatedAt: nullableString,
  familyMembers: z.array(familyMemberViewSchema),
});
export type CustomerDetailView = z.infer<typeof customerDetailViewSchema>;
export const customerDetailResponseSchema = z.object({ customer: customerDetailViewSchema });

/** GET /api/customers の1件(一覧。検索・地区の絞り込み・並び替えは画面側で行う)。 */
export const customerListItemSchema = z.object({
  id: idSchema,
  name: z.string(),
  phone: nullableString,
  city: nullableString,
});
export type CustomerListItem = z.infer<typeof customerListItemSchema>;

/** GET /api/customers(familyName 省略時)。cities は地区の重複無し・昇順の一覧。 */
export const customerListResponseSchema = z.object({
  customers: z.array(customerListItemSchema),
  cities: z.array(z.string()),
});
export type CustomerListResponse = z.infer<typeof customerListResponseSchema>;
