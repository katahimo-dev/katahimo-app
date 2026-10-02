import type { PushNotice } from '@katahimo/shared';
import { ASSESSMENT_DEFINITIONS } from '@katahimo/shared';
import { escapeChatText } from '../notifications/chatText';

/**
 * PSI 2 以下(注意・危険)の日報が保存されたときの管理者への知らせ(Web Push と Google Chat)。
 * 本文はスタッフ名・お客様の表示名・訪問日・PSI だけ(日報の本文・住所・電話番号は入れない)。
 */

const psiLabel = (riskRating: number) =>
  ASSESSMENT_DEFINITIONS.risk.levels.find((l) => l.score === riskRating)?.label ?? '';

export interface PsiAlertInput {
  recordId: string;
  riskRating: number;
  staffName: string;
  customerName: string;
  /** 訪問日 'YYYY-MM-DD'。 */
  date: string;
}

/** 管理者の端末に出す通知。tag は記録ごとに同じ(保存し直しても端末の上で置き換わる)。 */
export function buildPsiAlertNotice(input: PsiAlertInput): PushNotice {
  const [, m, d] = input.date.split('-');
  const urgent = input.riskRating === 1;
  return {
    title: `${urgent ? '🚨' : '⚠️'} PSI ${input.riskRating}（${psiLabel(input.riskRating)}）の日報`,
    body: `${input.staffName}さん・${input.customerName}様（${Number(m)}/${Number(d)}）\n${
      urgent ? 'すぐに担当スタッフへ連絡し、安全を確認してください。' : '日報の内容を確認してください。'
    }`,
    url: '/',
    tag: `psi-alert-${input.recordId}`,
  };
}

/** プッシュサービスの上で同じ記録の知らせをまとめる topic(base64url の文字だけ・32文字まで)。 */
export function psiAlertTopic(recordId: string): string {
  return recordId.replaceAll('-', '').slice(0, 32);
}

/** Google Chat(日報の Webhook)へ送る管理者向けの知らせ。 */
export function buildPsiAlertChatText(input: PsiAlertInput): string {
  const urgent = input.riskRating === 1;
  return `【${urgent ? 'PSI緊急' : 'PSI注意'}】PSI ${input.riskRating}（${psiLabel(input.riskRating)}）の日報が保存されました
担当: ${escapeChatText(input.staffName)}
顧客名: ${escapeChatText(input.customerName)}
訪問日: ${escapeChatText(input.date.replaceAll('-', '/'))}
${urgent ? '管理者はすぐに担当スタッフへ連絡し、安全対応を確認してください。' : '管理者は日報の内容を確認してください。'}`;
}
