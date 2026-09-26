import type { CreateStaffRequest, UpdateStaffRequest } from '@katahimo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminStaffApi } from '../../../api/admin';
import { queryKeys } from '../../../api/queryKeys';
import { adminQueryKeys } from '../adminQueryKeys';

export function useAdminStaffList() {
  return useQuery({ queryKey: adminQueryKeys.staff, queryFn: ({ signal }) => adminStaffApi.list(signal) });
}

/**
 * スタッフの登録・変更・削除・案内メール。書き込んだら一覧・「表示するスタッフ」の選択肢・操作ログを読み直す。
 */
export function useAdminStaffMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.staff }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activeStaff }),
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogsAll }),
    ]);
  return {
    create: useMutation({
      mutationFn: (body: CreateStaffRequest) => adminStaffApi.create(body),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ staffId, body }: { staffId: string; body: UpdateStaffRequest }) =>
        adminStaffApi.update(staffId, body),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (staffId: string) => adminStaffApi.remove(staffId),
      onSuccess: invalidate,
    }),
    sendPasswordGuide: useMutation({
      mutationFn: (staffId: string) => adminStaffApi.sendPasswordGuide(staffId),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogsAll }),
    }),
  };
}
