import {
  okResponseSchema,
  type PushSubscribeRequest,
  pushConfigResponseSchema,
  pushTestResponseSchema,
} from '@katahimo/shared';
import { api } from './client';

/** Web Push 通知の API(doc/04_API仕様.md)。購読はログイン中の本人の端末のものだけを扱う。 */
export const pushApi = {
  config: (signal?: AbortSignal) =>
    api.get('/api/push/config', pushConfigResponseSchema, undefined, { signal }),
  subscribe: (subscription: PushSubscribeRequest) =>
    api.post('/api/push/subscriptions', okResponseSchema, subscription),
  unsubscribe: (endpoint: string) => api.delete('/api/push/subscriptions', okResponseSchema, { endpoint }),
  sendTest: () => api.post('/api/push/test', pushTestResponseSchema),
};
