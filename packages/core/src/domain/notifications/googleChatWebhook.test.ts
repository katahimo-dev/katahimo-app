import { describe, expect, it } from 'vitest';
import { isGoogleChatWebhookUrl } from './googleChatWebhook';

describe('Google Chat Webhook URL の判定', () => {
  it('Incoming Webhook のURLを受け付ける', () => {
    expect(
      isGoogleChatWebhookUrl('https://chat.googleapis.com/v1/spaces/AAAAbc_-12/messages?key=k&token=t'),
    ).toBe(true);
  });

  it.each([
    'http://chat.googleapis.com/v1/spaces/AAAA/messages?key=k',
    'https://chat.googleapis.com.evil.example/v1/spaces/AAAA/messages',
    'https://evil.example/v1/spaces/AAAA/messages',
    'https://chat.googleapis.com:8443/v1/spaces/AAAA/messages',
    'https://user:pass@chat.googleapis.com/v1/spaces/AAAA/messages',
    'https://chat.googleapis.com/v1/spaces/AAAA/../../metadata',
    'https://chat.googleapis.com/v1/other',
    'http://169.254.169.254/computeMetadata/v1/',
    'not a url',
    '',
  ])('それ以外は拒否する: %s', (url) => {
    expect(isGoogleChatWebhookUrl(url)).toBe(false);
  });
});
