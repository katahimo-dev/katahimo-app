import type { calendar_v3 } from 'googleapis';
import type { CalendarApiClient } from './googleCalendarApiPort';

export interface CalendarApiClientOptions {
  /**
   * ドメイン全体の委任(domain-wide delegation)で成り代わるWorkspaceユーザーのメールアドレス。
   * 未指定ならサービスアカウント自身として読む(カレンダーをサービスアカウントに共有しておく方式)。
   */
  impersonateSubject?: string;
}

const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

/**
 * Application Default Credentials(GOOGLE_APPLICATION_CREDENTIALS のサービスアカウントキー、
 * またはCloud Runの実行サービスアカウント)で Google Calendar API を呼ぶクライアント。
 * googleapis は読み込みが重いため、最初の呼び出しまで import を遅らせる(APIの起動時間を延ばさない)。
 */
export function createCalendarApiClient(options: CalendarApiClientOptions = {}): CalendarApiClient {
  let calendarPromise: Promise<calendar_v3.Calendar> | null = null;
  const calendar = () => {
    calendarPromise ??= import('googleapis').then(({ google }) => {
      const auth = new google.auth.GoogleAuth({
        scopes: [CALENDAR_READONLY_SCOPE],
        ...(options.impersonateSubject ? { clientOptions: { subject: options.impersonateSubject } } : {}),
      });
      return google.calendar({ version: 'v3', auth });
    });
    return calendarPromise;
  };

  return {
    async listEvents(params) {
      return (await (await calendar()).events.list(params)).data;
    },
    async queryFreeBusy(body) {
      return (await (await calendar()).freebusy.query({ requestBody: body })).data;
    },
  };
}
