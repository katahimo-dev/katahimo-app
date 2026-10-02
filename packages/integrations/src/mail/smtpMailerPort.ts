import type { MailerPort, MailMessage } from '@katahimo/core/ports';
import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export interface SmtpMailerOptions {
  host: string;
  port: number;
  /** 465ならSMTPS(暗黙TLS)、それ以外はSTARTTLS。 */
  secure?: boolean;
  /**
   * STARTTLS を必須にするか(既定 true)。true なら、サーバーが STARTTLS を出さない・TLS に切り替えられないときは
   * 平文で続けずに送信を失敗にする(途中の経路で STARTTLS を消されて、認証情報・再設定コードが平文で流れるのを防ぐ)。
   * false は TLS の無い開発用の SMTP(Mailpit 等)だけ(ワーカーの SMTP_REQUIRE_TLS。本番では起動時に断る)。
   */
  requireTls?: boolean;
  user?: string;
  pass?: string;
  /** 差出人('保育日報 <noreply@example.com>' 等)。 */
  from: string;
}

/** TLS の最低の版(TLS 1.0/1.1 は使わない)。 */
export const SMTP_MIN_TLS_VERSION = 'TLSv1.2';

/** nodemailer の SMTP の設定(テストで中身を確かめるため、組み立てを分ける)。 */
export function smtpTransportOptions(options: SmtpMailerOptions): SMTPTransport.Options {
  const secure = options.secure ?? options.port === 465;
  return {
    host: options.host,
    port: options.port,
    secure,
    // 暗黙TLS(465)は最初から TLS。STARTTLS(587 等)は切り替えを必須にする
    ...(secure ? {} : { requireTLS: options.requireTls ?? true }),
    tls: { minVersion: SMTP_MIN_TLS_VERSION },
    ...(options.user ? { auth: { user: options.user, pass: options.pass ?? '' } } : {}),
  };
}

/** SMTPでメールを送るMailerPort(GAS版MailApp.sendEmailの置き換え)。 */
export class SmtpMailerPort implements MailerPort {
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpMailerOptions) {
    this.transporter = nodemailer.createTransport(smtpTransportOptions(options));
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
