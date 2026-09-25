import type { MailerPort, MailMessage } from '@katahimo/core/ports';

/**
 * 開発用のMailerPort。SMTPが未設定の環境で使い、送信する代わりに内容を標準出力へ出す
 * (パスワード再設定コードをローカルで確認するため)。本番(NODE_ENV=production)では使わない。
 */
export class ConsoleMailerPort implements MailerPort {
  async send(message: MailMessage): Promise<void> {
    console.log(
      [
        '[ConsoleMailer] メール送信(開発用・実際には送信していません)',
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
      ].join('\n'),
    );
  }
}
