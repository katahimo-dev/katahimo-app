import type { ActiveStaff } from '@katahimo/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { queryKeys } from '../../api/queryKeys';
import { staffApi } from '../../api/staff';
import { useSession } from '../../features/auth';

/**
 * 管理者用「表示するスタッフ」。予定タブと出勤簿タブで共有する(GAS版 sharedAdminTargetStaffName /
 * loadSharedAdminStaffList_ / onAdminTargetStaffChange_)。
 *
 * - 一覧(GET /api/staff)は、どちらかのタブが `<AdminTargetStaffSelect />` を出したときに1回だけ読む。
 * - 選んだスタッフは両方のタブに反映される。各タブは `requestStaffId` をAPIの `staffId` と
 *   クエリキーに入れておけば、選び直したときに自動で読み直される(GAS版は明示的に読み直していた)。
 * - 管理者以外は常に本人(`requestStaffId` は undefined = APIに staffId を送らない)。
 *   サーバーも管理者以外の staffId は無視する(admin-vs-self パターン)。
 */
interface AdminTargetStaffContextValue {
  isAdmin: boolean;
  /** 選択中のスタッフID(管理者以外は本人のID) */
  targetStaffId: string;
  /** 選択中のスタッフ名(一覧の読み込み前は本人の名前) */
  targetStaffName: string;
  /** APIに渡す staffId(管理者のときだけ値が入る。GAS版 getScheduleTargetStaffName_) */
  requestStaffId: string | undefined;
  /** 選択肢(退職者を除く、氏名順)。管理者以外・読み込み前は空 */
  staffList: ActiveStaff[];
  setTargetStaffId: (staffId: string) => void;
  /** 一覧の読み込みを始める(何度呼んでも1回だけ読む) */
  requestStaffList: () => void;
  staffListLoaded: boolean;
}

const AdminTargetStaffContext = createContext<AdminTargetStaffContextValue | null>(null);

export function AdminTargetStaffProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [targetStaffId, setTargetStaffIdState] = useState(user.staffId);
  const [listRequested, setListRequested] = useState(false);

  const staffQuery = useQuery({
    queryKey: queryKeys.activeStaff,
    queryFn: ({ signal }) => staffApi.listActive(signal),
    enabled: user.isAdmin && listRequested,
    staleTime: Number.POSITIVE_INFINITY,
    select: (res) => res.staff,
  });

  const requestStaffList = useCallback(() => setListRequested(true), []);
  const setTargetStaffId = useCallback(
    (staffId: string) => {
      if (user.isAdmin) setTargetStaffIdState(staffId);
    },
    [user.isAdmin],
  );

  const value = useMemo<AdminTargetStaffContextValue>(() => {
    const staffList = user.isAdmin ? (staffQuery.data ?? []) : [];
    const effectiveId = user.isAdmin ? targetStaffId : user.staffId;
    const targetStaffName = staffList.find((s) => s.id === effectiveId)?.name ?? user.name;
    return {
      isAdmin: user.isAdmin,
      targetStaffId: effectiveId,
      targetStaffName,
      requestStaffId: user.isAdmin ? effectiveId : undefined,
      staffList,
      setTargetStaffId,
      requestStaffList,
      staffListLoaded: staffQuery.isSuccess,
    };
  }, [user, targetStaffId, staffQuery.data, staffQuery.isSuccess, setTargetStaffId, requestStaffList]);

  return <AdminTargetStaffContext value={value}>{children}</AdminTargetStaffContext>;
}

export function useAdminTargetStaff(): AdminTargetStaffContextValue {
  const value = useContext(AdminTargetStaffContext);
  if (!value) throw new Error('useAdminTargetStaff は AdminTargetStaffProvider の中で使ってください');
  return value;
}
