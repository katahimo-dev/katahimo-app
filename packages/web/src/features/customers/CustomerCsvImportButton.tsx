import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { customersApi } from '../../api/customers';
import { queryKeys } from '../../api/queryKeys';
import { showErrorToast } from '../../ui/toast';
import { customerCsvImportMessage } from './customerCsvImportMessage';

/**
 * 「🔄 お客様の情報を今すぐ取り込む」(コーディネーター・管理者だけ)。RESERVA の顧客CSVは10分ごとに取り込むが、
 * 初めて訪問するお客様が直前に登録されたときに待たずに日報を書けるよう、取込元の最新のCSVをその場で取り込む。
 * 取り込めたら顧客データの版数を新しくし、データ版数の監視が一覧を読み直す(他の画面の「新しい情報があります」と同じ)。
 */
export function CustomerCsvImportButton() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: customersApi.importLatestCsv,
    onSuccess: (res) => {
      setResult(customerCsvImportMessage(res));
      if (res.status === 'imported') {
        queryClient.setQueryData(queryKeys.dataVersion, { dataVersion: res.dataVersion });
      }
    },
    onError: (e) => {
      setResult(null);
      showErrorToast(e);
    },
  });

  return (
    <div className="mb-4">
      <button
        type="button"
        id="customerCsvImportBtn"
        onClick={() => run.mutate()}
        disabled={run.isPending}
        className="w-full min-h-12 py-3 bg-white border-2 border-gray-300 text-gray-700 text-base font-bold rounded-xl transition-colors disabled:opacity-60"
      >
        {run.isPending ? '取り込んでいます…' : '🔄 お客様の情報を今すぐ取り込む'}
      </button>
      {result ? (
        <p id="customerCsvImportResult" className="mt-1 text-sm text-gray-600" role="status">
          {result}
        </p>
      ) : null}
    </div>
  );
}
