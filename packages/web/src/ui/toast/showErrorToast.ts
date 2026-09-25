import { isUnauthenticated, userMessageOf } from '../../api/client';
import { showToast } from './toastStore';

/**
 * APIの失敗を赤いお知らせで出す(GAS版の withFailureHandler / success:false の showToast(…, true))。
 * セッション切れ(401)はログイン画面に戻って案内を出すため、お知らせは出さない。
 */
export function showErrorToast(error: unknown, fallbackMessage?: string) {
  if (isUnauthenticated(error)) return;
  showToast(userMessageOf(error) || fallbackMessage || '', true);
}
