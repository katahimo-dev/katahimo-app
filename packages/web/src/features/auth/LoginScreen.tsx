import type { SessionUser } from '@katahimo/shared';
import { PASSWORD_RESET_CODE_PATTERN } from '@katahimo/shared';
import { useMemo, useState } from 'react';
import { authApi } from '../../api/auth';
import { userMessageOf } from '../../api/client';
import { demoLoginNoticeLines, demoTermsValuesOf } from '../../lib/demo';
import { normalizeTenantSlug, rememberTenantSlug, resolveTenantFromBrowser } from '../../lib/tenant';
import { alertNative } from '../../ui/confirm';
import { useVisibilityToggle } from '../../ui/useVisibilityToggle';
import { useDemoConfig } from './demo/useDemoConfig';
import { type LoginFormValues, LoginModal } from './LoginModal';
import { ResetRequestModal } from './ResetRequestModal';
import { RESET_CODE_LABEL, ResetVerifyModal } from './ResetVerifyModal';

type Step = 'login' | 'resetRequest' | 'resetVerify';

interface LoginScreenProps {
  /** 最初からログイン画面に出しておく案内(例: 「しばらく使っていなかったので…」) */
  initialError?: string;
  onLoggedIn: (user: SessionUser) => void;
}

/**
 * 未ログインのときの画面。GAS版の3つのダイアログ(#loginModal / #resetRequestModal /
 * #resetVerifyModal)の行き来と、doLogin / doRequestReset / doCompleteReset の検証・文言を再現する。
 * 入力した値はGAS版(DOMが残る)と同じく、ダイアログを行き来しても残る。
 */
export function LoginScreen({ initialError = '', onLoggedIn }: LoginScreenProps) {
  const browserTenant = useMemo(() => resolveTenantFromBrowser(), []);
  const { config: demo, pending: demoPending } = useDemoConfig();
  // デモ専用の環境(publicLogin)で法人IDが決まらなければ、デモ用テナントを既定にする(法人ID欄を出さない)。
  // ビルドの既定値・?t=・最後にログインできた法人IDのほうを先に使う(lib/tenant.ts の順番のあと)。
  const resolvedSlug =
    browserTenant?.slug ?? (demo.enabled && demo.publicLogin ? normalizeTenantSlug(demo.tenantSlug) : null);
  // デモの設定を読んでいる間は法人ID欄を出さない(読めるとデモ用テナントに決まることがあり、欄がちらつくため)
  const showTenantField = resolvedSlug === null && !demoPending;

  const [step, setStep] = useState<Step>('login');
  const [login, setLogin] = useState<LoginFormValues>({ tenantSlug: '', email: '', password: '' });
  const [loginError, setLoginError] = useState(initialError);
  const [loggingIn, setLoggingIn] = useState(false);
  const passwordVisibility = useVisibilityToggle();

  const [resetEmail, setResetEmail] = useState('');
  const [resetRequestError, setResetRequestError] = useState('');
  const [requestingReset, setRequestingReset] = useState(false);
  /** 番号を送ったメールアドレス(GAS版 window._resetUserId) */
  const [resetTargetEmail, setResetTargetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetVerifyError, setResetVerifyError] = useState('');
  const [completingReset, setCompletingReset] = useState(false);

  const tenantSlug = resolvedSlug ?? login.tenantSlug.trim();

  // 公開デモ: ログインの前に、入力した内容・接続情報を保存することを知らせる(ログインでも IPアドレス等を記録するため)。
  // 入る法人ID(既定・?t=・最後にログインした法人ID・入力)がデモ用テナントのときだけ出す(デモ専用の環境でも、
  // ほかの法人に入るときは出さない。「パスワードを忘れたとき」もデモ用テナントのときだけ隠す)。
  const demoSlug = demo.enabled ? normalizeTenantSlug(demo.tenantSlug) : null;
  const demoSlugEntered = demoSlug !== null && normalizeTenantSlug(tenantSlug) === demoSlug;
  const demoNotice = demo.enabled && demoSlugEntered ? demoLoginNoticeLines(demoTermsValuesOf(demo)) : null;
  // デモ用アカウントはデモ専用の環境で、デモ用テナントに入るときだけ出す(ほかの法人IDでは使えないため)
  const demoAccounts =
    demo.enabled && demo.publicLogin && demoSlugEntered && demo.password !== null && demo.accounts.length > 0
      ? { accounts: demo.accounts, password: demo.password }
      : null;

  const doLogin = async () => {
    if (!login.email || !login.password || !tenantSlug) {
      setLoginError('入力してください');
      return;
    }
    setLoggingIn(true);
    setLoginError('');
    try {
      const { staff } = await authApi.login({ tenantSlug, email: login.email, password: login.password });
      rememberTenantSlug(tenantSlug);
      // パスワード欄は初期状態(空欄・非表示)に戻す(GAS版 resetLoginPassField_)
      setLogin((v) => ({ ...v, password: '' }));
      passwordVisibility.reset();
      onLoggedIn(staff);
    } catch (e) {
      setLoginError(userMessageOf(e));
    } finally {
      setLoggingIn(false);
    }
  };

  const doRequestReset = async () => {
    if (!resetEmail || !tenantSlug) return;
    setRequestingReset(true);
    setResetRequestError('');
    try {
      await authApi.requestPasswordReset({ tenantSlug, email: resetEmail });
      setResetTargetEmail(resetEmail);
      setStep('resetVerify');
    } catch (e) {
      setResetRequestError(userMessageOf(e));
    } finally {
      setRequestingReset(false);
    }
  };

  /** 番号がもうメールで届いている(管理者のパスワード設定の案内)ときは、送り直さずに番号の入力へ進む。 */
  const goToCodeEntry = () => {
    if (!tenantSlug || !resetEmail) {
      setResetRequestError(tenantSlug ? 'メールアドレスを入力してください' : '法人IDを入力してください');
      return;
    }
    setResetRequestError('');
    setResetTargetEmail(resetEmail);
    setStep('resetVerify');
  };

  const doCompleteReset = async () => {
    if (!resetCode || !resetNewPassword) {
      setResetVerifyError('全ての項目を入力してください');
      return;
    }
    if (!PASSWORD_RESET_CODE_PATTERN.test(resetCode)) {
      setResetVerifyError(`${RESET_CODE_LABEL}を入力してください`);
      return;
    }
    setCompletingReset(true);
    setResetVerifyError('');
    try {
      await authApi.confirmPasswordReset({
        tenantSlug,
        email: resetTargetEmail,
        code: resetCode,
        newPassword: resetNewPassword,
      });
      alertNative('パスワードがリセットされました。新しいパスワードでログインしてください。');
      setStep('login');
    } catch (e) {
      setResetVerifyError(userMessageOf(e));
    } finally {
      setCompletingReset(false);
    }
  };

  if (step === 'resetRequest') {
    return (
      <ResetRequestModal
        email={resetEmail}
        onEmailChange={setResetEmail}
        showTenantField={showTenantField}
        tenantSlug={login.tenantSlug}
        onTenantSlugChange={(slug) => setLogin((v) => ({ ...v, tenantSlug: slug }))}
        error={resetRequestError}
        submitting={requestingReset}
        onCancel={() => setStep('login')}
        onSubmit={doRequestReset}
        onHaveCode={goToCodeEntry}
      />
    );
  }

  if (step === 'resetVerify') {
    return (
      <ResetVerifyModal
        code={resetCode}
        onCodeChange={setResetCode}
        newPassword={resetNewPassword}
        onNewPasswordChange={setResetNewPassword}
        error={resetVerifyError}
        submitting={completingReset}
        onCancel={() => setStep('login')}
        onSubmit={doCompleteReset}
      />
    );
  }

  return (
    <LoginModal
      values={login}
      onChange={setLogin}
      showTenantField={showTenantField}
      error={loginError}
      submitting={loggingIn}
      passwordVisibility={passwordVisibility}
      onSubmit={doLogin}
      onForgotPassword={() => setStep('resetRequest')}
      hideForgotPassword={demoSlugEntered}
      demoNotice={demoNotice}
      demoAccounts={demoAccounts}
    />
  );
}
