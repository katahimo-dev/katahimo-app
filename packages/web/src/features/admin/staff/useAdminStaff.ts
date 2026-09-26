import type { CreateStaffRequest, UpdateStaffRequest } from '@katahimo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminStaffApi } from '../../../api/admin';
import { ApiRequestError } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { useSession } from '../../auth';
import { adminQueryKeys } from '../adminQueryKeys';

export function useAdminStaffList() {
  return useQuery({ queryKey: adminQueryKeys.staff, queryFn: ({ signal }) => adminStaffApi.list(signal) });
}

/**
 * スタッフの登録・変更・削除・案内メール。書き込んだら一覧・「表示するスタッフ」の選択肢・操作ログを読み直す
 * (自分自身を変えたらヘッダーの名前のためにログイン中の人も)。他の管理者と重なって断られた(409)ときも一覧を
 * 読み直す(古い版のまま何度も断られないように)。
 */
export function useAdminStaffMutations() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const invalidate = (staffId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.staff }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activeStaff }),
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogsAll }),
      ...(staffId === user.staffId ? [queryClient.invalidateQueries({ queryKey: queryKeys.session })] : []),
    ]);
  const reloadOnConflict = (error: unknown) =>
    error instanceof ApiRequestError && error.code === 'conflict'
      ? queryClient.invalidateQueries({ queryKey: adminQueryKeys.staff })
      : undefined;
  return {
    create: useMutation({
      mutationFn: (body: CreateStaffRequest) => adminStaffApi.create(body),
      onSuccess: () => invalidate(),
    }),
    update: useMutation({
      mutationFn: ({ staffId, body }: { staffId: string; body: UpdateStaffRequest }) =>
        adminStaffApi.update(staffId, body),
      onSuccess: (_result, { staffId }) => invalidate(staffId),
      onError: reloadOnConflict,
    }),
    remove: useMutation({
      mutationFn: (staffId: string) => adminStaffApi.remove(staffId),
      onSuccess: () => invalidate(),
      onError: reloadOnConflict,
    }),
    sendPasswordGuide: useMutation({
      mutationFn: (staffId: string) => adminStaffApi.sendPasswordGuide(staffId),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: adminQueryKeys.auditLogsAll }),
    }),
  };
}
