import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SMTP_MIN_TLS_VERSION, SmtpMailerPort, smtpTransportOptions } from './smtpMailerPort';

describe('smtpTransportOptions', () => {
  it('STARTTLS(587 等)は既定で TLS への切り替えを必須にし、TLS 1.2 以上だけを使う', () => {
    expect(smtpTransportOptions({ host: 'smtp.example.com', port: 587, from: 'a@example.com' })).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      tls: { minVersion: SMTP_MIN_TLS_VERSION },
    });
  });

  it('465 は暗黙TLS(requireTLS は付けない)、認証情報があれば auth を付ける', () => {
    expect(
      smtpTransportOptions({ host: 'h', port: 465, user: 'u', pass: 'p', from: 'a@example.com' }),
    ).toEqual({
      host: 'h',
      port: 465,
      secure: true,
      tls: { minVersion: 'TLSv1.2' },
      auth: { user: 'u', pass: 'p' },
    });
  });

  it('requireTls: false(開発用の SMTP だけ)なら STARTTLS を必須にしない', () => {
    expect(smtpTransportOptions({ host: 'h', port: 1025, requireTls: false, from: 'a' })).toMatchObject({
      requireTLS: false,
    });
  });
});

/** STARTTLS を出さない(途中で消された想定の)SMTP サーバー。受け取ったコマンドを記録する。 */
function startPlainSmtpServer(): Promise<{ server: Server; port: number; commands: string[] }> {
  const commands: string[] = [];
  const server = createServer((socket) => {
    socket.write('220 localhost ESMTP test\r\n');
    let buffer = '';
    let inData = false;
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx = buffer.indexOf('\r\n');
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 OK queued\r\n');
          }
        } else {
          commands.push(line.split(' ')[0]?.toUpperCase() ?? '');
          const verb = commands.at(-1);
          if (verb === 'EHLO') socket.write('250-localhost\r\n250 8BITMIME\r\n');
          else if (verb === 'STARTTLS') socket.write('502 command not implemented\r\n');
          else if (verb === 'DATA') {
            inData = true;
            socket.write('354 go ahead\r\n');
          } else if (verb === 'QUIT') socket.end('221 bye\r\n');
          else socket.write('250 OK\r\n');
        }
        idx = buffer.indexOf('\r\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0, commands });
    });
  });
}

describe('SmtpMailerPort(STARTTLS の格下げ)', () => {
  let server: Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  const message = { to: 'staff@example.com', subject: 'テスト', text: 'コード: 12345678' };

  it('サーバーが STARTTLS を出さなければ、平文では送らずに失敗する(本文・宛先を送らない)', async () => {
    const started = await startPlainSmtpServer();
    server = started.server;
    const mailer = new SmtpMailerPort({ host: '127.0.0.1', port: started.port, from: 'noreply@example.com' });
    await expect(mailer.send(message)).rejects.toThrow();
    expect(started.commands).not.toContain('MAIL');
    expect(started.commands).not.toContain('DATA');
  });

  it('requireTls: false(開発用)なら TLS の無いサーバーにも送る', async () => {
    const started = await startPlainSmtpServer();
    server = started.server;
    const mailer = new SmtpMailerPort({
      host: '127.0.0.1',
      port: started.port,
      requireTls: false,
      from: 'noreply@example.com',
    });
    await mailer.send(message);
    expect(started.commands).toEqual(expect.arrayContaining(['EHLO', 'MAIL', 'RCPT', 'DATA']));
  });
});
