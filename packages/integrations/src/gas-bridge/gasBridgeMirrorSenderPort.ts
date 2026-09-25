import type {
  AccidentReportMirrorPayload,
  AttendanceDayMirrorPayload,
  DailyReportMirrorPayload,
  MirrorSenderPort,
  ReceiptMirrorPayload,
} from '@katahimo/core/ports';
import type { GasBridgeOptions } from './gasBridgeClient';
import { GasBridgeClient } from './gasBridgeClient';

interface BridgeWriteResult {
  success: boolean;
  message?: string;
}

/**
 * outboxから取り出したミラージョブを、GAS版(gas-childcare-visit-app)のWeb Appデプロイ(Bridge.js)
 * 経由でGoogleスプレッドシート/Driveへ書き込む。読み取り側(GasBridgeSchedulePort/
 * GasBridgeMapsPort)と同じく、実際にどの列に書くかのロジックはBridge.js側(GAS版本番のシート
 * 構造をそのまま知っている)に置き、こちらはペイロードを渡すだけにする。
 *
 * Bridge.js側の書き込みaction(writeDailyReport/writeAccidentReport/writeReceipt/
 * writeAttendanceDay)は、読み取り側のaction追加時と同じくデプロイ承認待ち
 * (CLAUDE.mdの運用ルール、doc/README参照)。
 */
export class GasBridgeMirrorSenderPort implements MirrorSenderPort {
  private readonly client: GasBridgeClient;

  constructor(options: GasBridgeOptions) {
    this.client = new GasBridgeClient(options);
  }

  private async post(action: string, body: unknown): Promise<void> {
    const result = await this.client.postJson<BridgeWriteResult>(action, body);
    if (!result.success) {
      throw new Error(result.message || `Bridge書き込みに失敗しました(action=${action})`);
    }
  }

  async sendDailyReport(payload: DailyReportMirrorPayload): Promise<void> {
    await this.post('writeDailyReport', payload);
  }

  async sendAccidentReport(payload: AccidentReportMirrorPayload): Promise<void> {
    await this.post('writeAccidentReport', payload);
  }

  async sendReceipt(payload: ReceiptMirrorPayload): Promise<void> {
    await this.post('writeReceipt', payload);
  }

  async sendAttendanceDay(payload: AttendanceDayMirrorPayload): Promise<void> {
    await this.post('writeAttendanceDay', payload);
  }
}

/** GAS_BRIDGE_URL/SECRET未設定時のフォールバック。何もせず成功扱いにする(ミラーはスキップ)。 */
export class NoopMirrorSenderPort implements MirrorSenderPort {
  async sendDailyReport(): Promise<void> {}
  async sendAccidentReport(): Promise<void> {}
  async sendReceipt(): Promise<void> {}
  async sendAttendanceDay(): Promise<void> {}
}
