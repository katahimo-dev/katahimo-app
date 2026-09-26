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
  /** 最後に登録し直した・送った・失敗した時刻(1人あたりの上限を超えたときに古いものから消す順)。 */
  updatedAt: Date;
  lastSuccessAt: Date | null;
  /** プッシュサービスに断られた(404 / 410 / 429 以外の 4xx)回数の続き。成功・登録し直しで0に戻す。 */
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
  findById(id: string): Promise<PushSubscriptionRecord | null>;
  findByEndpoint(endpoint: string): Promise<PushSubscriptionRecord | null>;
  /** endpoint で登録し直す(あれば持ち主・鍵を書き換え、失敗の回数を0に戻す)。 */
  upsert(input: PushSubscriptionUpsert): Promise<PushSubscriptionRecord>;
  /** そのスタッフの購読のうち、新しい(updated_at の遅い)keep 件を残して消す。消した数。 */
  trimForStaff(staffId: string, keep: number): Promise<number>;
  /** そのスタッフの endpoint の購読を消す(他のスタッフの購読は消さない)。消した購読の ID(無ければ null)。 */
  deleteForStaff(staffId: string, endpoint: string): Promise<string | null>;
  /** そのスタッフの購読を全て消す(退職)。消した数。 */
  deleteAllForStaff(staffId: string): Promise<number>;
  listForStaff(staffId: string): Promise<PushSubscriptionRecord[]>;
  /** 購読を1つ以上持つスタッフの ID。 */
  listSubscribedStaffIds(): Promise<string[]>;
  recordSuccess(id: string, at: Date): Promise<void>;
  /** 再試行すれば直りうる失敗(5xx・429・通信)。時刻だけを残す(回数は数えない)。 */
  recordRetryableFailure(id: string, at: Date): Promise<void>;
  /** プッシュサービスに断られた(再試行しない)。続いた回数を1増やし、増やした後の回数を返す。 */
  recordRejection(id: string, at: Date): Promise<number>;
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
 * 送った結果。delivered = プッシュサービスが受け付けた / expired = 購読がもう無い(404 / 410。消してよい) /
 * rejected = それ以外の 4xx(429 を除く。鍵・中身・購読の不整合で、送り直しても直らない)。
 * 再試行すれば直りうる失敗(5xx・429・通信の失敗・タイムアウト)は例外を投げる(outbox の再試行に任せる)。
 */
export type WebPushSendResult =
  | { status: 'delivered' }
  | { status: 'expired'; statusCode: number }
  | { status: 'rejected'; statusCode: number };

/**
 * Web Push の送信(VAPID で署名し、RFC 8291 で暗号化して endpoint へ POST する)。実装は @katahimo/integrations の
 * WebPushSender(web-push パッケージ)。VAPID の設定が無い環境では使わない(ワーカーは push.* を送らずに完了にする)。
 */
export interface WebPushSenderPort {
  send(target: WebPushTarget, notice: PushNotice, options: WebPushSendOptions): Promise<WebPushSendResult>;
}
