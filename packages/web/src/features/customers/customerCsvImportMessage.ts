import type { CustomerCsvImportResponse } from '@katahimo/shared';

/**
 * 「今すぐ取り込む」の結果を1行の文にする(成功の応答だけ。409・502 はふつうの API のエラーとして出す)。
 * 取り込んだときは新しく増えたお客様の人数を先に出す(押すのは新しいお客様を探しているとき)。
 */
export function customerCsvImportMessage(res: CustomerCsvImportResponse): string {
  switch (res.status) {
    case 'imported': {
      const created = res.stats?.created ?? 0;
      const updated = res.stats?.updated ?? 0;
      const archived = res.stats?.archived ?? 0;
      const counts = [`新しいお客様 ${created}件`, `変更 ${updated}件`];
      if (archived > 0) counts.push(`一覧から外れた ${archived}件`);
      return `取り込みました(${counts.join('・')})`;
    }
    case 'up_to_date':
      return '最新のお客様の情報は取り込み済みです';
    default:
      return res.message;
  }
}
