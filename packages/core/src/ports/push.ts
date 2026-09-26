import type { PushNotice } from '@katahimo/shared';

export type { PushNotice };

/**
 * Web Push の購読(push_subscriptions)と送信のポート。購読はスタッフの端末(ブラウザ)ごとに1行で、endpoint は
 * テナントの中で一意(同じ端末で別のスタッフが登録し直したら、そのスタッフの購読に付け替える)。
 */
export interface PushSubscriptionRecord {
  id: string;
  staffId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: Date;
  lastSuccessAt: Date | null;
  failureCount: number;
}

export interface PushSubscriptionUpsert {
  /** 新しく作る場合の ID(既にある endpoint なら既存の ID のまま)。 */
  id: string;
  staffId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export interface PushSubscriptionRepository {
  findByEndpoint(endpoint: string): Promise<PushSubscriptionRecord | null>;
  /** endpoint で登録し直す(あれば持ち主・鍵を書き換え、失敗の回数を0に戻す)。 */
  upsert(input: PushSubscriptionUpsert): Promise<PushSubscriptionRecord>;
  /** そのスタッフの endpoint の購読を消す(他のスタッフの購読は消さない)。消した購読の ID(無ければ null)。 */
  deleteForStaff(staffId: string, endpoint: string): Promise<string | null>;
  listForStaff(staffId: string): Promise<PushSubscriptionRecord[]>;
  /** 購読を1つ以上持つスタッフの ID。 */
  listSubscribedStaffIds(): Promise<string[]>;
  recordSuccess(id: string, at: Date): Promise<void>;
  recordFailure(id: string, at: Date): Promise<void>;
  /** プッシュサービスが「もう無い」(404 / 410)と答えた購読を消す。 */
  delete(id: string): Promise<void>;
}

/** 送り先(購読の endpoint と暗号化の鍵)。 */
export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushSendOptions {
  /** プッシュサービスが端末に届けるまで待つ秒数(端末がオフラインの間)。 */
  ttlSeconds: number;
  /** 同じ topic の届いていない通知は、プッシュサービスの上で新しい方に置き換わる(base64url 32文字まで)。 */
  topic: string;
}

/**
 * 送った結果。delivered = プッシュサービスが受け付けた / expired = 購読がもう無い(404 / 410。消してよい)。
 * それ以外の失敗(5xx・429・通信の失敗等)は例外を投げる(outbox の再試行に任せる)。
 */
export type WebPushSendResult = 'delivered' | 'expired';

/**
 * Web Push の送信(VAPID で署名し、RFC 8291 で暗号化して endpoint へ POST する)。実装は @katahimo/integrations の
 * WebPushSender(web-push パッケージ)。VAPID の設定が無い環境では使わない(ワーカーは push.* を送らずに完了にする)。
 */
export interface WebPushSenderPort {
  send(target: WebPushTarget, notice: PushNotice, options: WebPushSendOptions): Promise<WebPushSendResult>;
}
