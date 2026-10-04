import type { Socket } from 'node:net';
import type { CloudSqlConnectorTarget } from './connection';

/** postgres.js の `socket` オプションに渡す、接続ごとのソケットの作り方と後片付け。 */
export interface CloudSqlSocketFactory {
  socket: () => Promise<Socket>;
  close: () => void;
}

/**
 * Cloud SQL の言語コネクタ(@google-cloud/cloud-sql-connector)で、接続ごとに TLS のソケットを作る。
 * コネクタは実行サービスアカウント(ADC)で Cloud SQL Admin API から接続先と短期の証明書を取り(IAM の
 * roles/cloudsql.client が要る)、インスタンスの証明書を確かめた TLS でつなぐ。Cloud Run の組み込みの Cloud SQL 接続
 * (Unix ソケット)と同じ守りで、プライベート IP だけのインスタンスにも直接届く(Direct VPC egress。infra/gcp/network.tf)。
 *
 * - コネクタのモジュールは最初の接続のときに読み込む(使わない開発・テストで Google の認証ライブラリ等を読まない)。
 * - 接続先の情報(getOptions)はプールで1回だけ取り、失敗したら次の接続で取り直す。証明書の更新はコネクタが裏で行う。
 * - close はコネクタの更新のタイマーを止める(closeDatabase が呼ぶ。止めないとジョブのプロセスが終わらない)。
 */
export function cloudSqlSocketFactory(target: CloudSqlConnectorTarget): CloudSqlSocketFactory {
  let connector: import('@google-cloud/cloud-sql-connector').Connector | null = null;
  let options: Promise<{ stream: () => Socket }> | null = null;
  let closed = false;

  const load = async () => {
    const { Connector, IpAddressTypes } = await import('@google-cloud/cloud-sql-connector');
    if (closed) throw new Error('Cloud SQL のコネクタは閉じています');
    connector ??= new Connector();
    return connector.getOptions({
      instanceConnectionName: target.instanceConnectionName,
      ipType: IpAddressTypes[target.ipType],
    });
  };

  return {
    socket: async () => {
      options ??= load().catch((error: unknown) => {
        options = null;
        throw error;
      });
      return (await options).stream();
    },
    close: () => {
      closed = true;
      connector?.close();
      connector = null;
      options = null;
    },
  };
}
