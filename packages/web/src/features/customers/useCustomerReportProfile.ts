import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customerQueryKeys, customersApi } from '../../api/customers';
import { showErrorToast, showToast } from '../../ui/toast';

/**
 * 家庭の教育思考★(日報AIの言葉選び)を読み・変える(お客様の詳細と日報のダイアログで共有)。
 * 変えるときは読んだ版を送り、他の人が先に変えていれば(409)知らせて読み直す。
 */
export function useCustomerReportProfile(customerId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: customerQueryKeys.reportProfile(customerId ?? ''),
    queryFn: ({ signal }) => customersApi.reportProfile(customerId as string, signal),
    enabled: enabled && customerId !== null,
    select: (res) => res.profile,
  });
  const profile = query.data;
  const save = useMutation({
    mutationFn: ({
      id,
      level,
      rowVersion,
    }: {
      id: string;
      level: number | null;
      rowVersion: number | null;
    }) =>
      customersApi.saveReportProfile(id, {
        educationLevel: level,
        ...(rowVersion === null ? {} : { rowVersion }),
      }),
    onSuccess: (res, { id }) => {
      queryClient.setQueryData(customerQueryKeys.reportProfile(id), res);
      const level = res.profile.educationLevel;
      showToast(
        level === null ? 'ご家庭の教育思考を未設定に戻しました' : `ご家庭の教育思考を★${level}にしました`,
      );
    },
    onError: (error, { id }) => {
      showErrorToast(error);
      void queryClient.invalidateQueries({ queryKey: customerQueryKeys.reportProfile(id) });
    },
  });
  return {
    /** 家庭の★(未設定は null、読み込み中は undefined) */
    educationLevel: profile ? profile.educationLevel : undefined,
    updatedByName: profile?.updatedByName ?? null,
    saving: save.isPending,
    /** null は未設定に戻す(画面からは使わない。未設定は★2 として見せる)。 */
    setEducationLevel: (level: number | null) => {
      if (!customerId || !profile) return;
      save.mutate({ id: customerId, level, rowVersion: profile.rowVersion });
    },
  };
}
