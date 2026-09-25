import type { MailerPort, MailMessage } from '@katahimo/core/ports';
import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';

export interface SmtpMailerOptions {
  host: string;
  port: number;
  /** 465ならSMTPS(暗黙TLS)、それ以外はSTARTTLS。 */
  secure?: boolean;
  user?: string;
  pass?: string;
  /** 差出人('保育日報 <noreply@example.com>' 等)。 */
  from: string;
}

/** SMTPでメールを送るMailerPort(GAS版MailApp.sendEmailの置き換え)。 */
export class SmtpMailerPort implements MailerPort {
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpMailerOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? options.port === 465,
      auth: options.user ? { user: options.user, pass: options.pass ?? '' } : undefined,
    });
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
