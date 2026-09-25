/**
 * メール送信のポート(GAS版 MailApp.sendEmail に相当)。現状はパスワード再設定コードの送信のみに使う。
 * 実装は @katahimo/integrations の SmtpMailerPort(SMTP_*設定時)と ConsoleMailerPort(開発用、
 * 本文を標準出力に出すだけ)。
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** プレーンテキスト本文。 */
  text: string;
}

export interface MailerPort {
  /** 送信に失敗した場合は例外を投げる(呼び出し側がログに記録する)。 */
  send(message: MailMessage): Promise<void>;
}
