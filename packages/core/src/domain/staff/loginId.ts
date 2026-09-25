/**
 * パスワード再設定コードの送信先を決める。GAS版Auth.js resolveResetMailAddress_と同じ規則で、
 * 利用者が入力した文字列そのものではなく、スタッフ台帳に登録済みのアドレスだけを宛先にする。
 * サブメール(altEmail)で一致した場合はサブメール宛(旧アドレスが使えなくなっていても再設定できる
 * ようにするため)、それ以外はメイン(email)宛。
 *
 * normalizedLoginIdは`normalizeEmailForIndex`で正規化済みの入力値。
 */
export function resolvePasswordResetAddress(
  staff: { email: string; altEmail: string | null },
  normalizedLoginId: string,
): string {
  if (staff.altEmail && staff.altEmail === normalizedLoginId) return staff.altEmail;
  return staff.email || staff.altEmail || '';
}
