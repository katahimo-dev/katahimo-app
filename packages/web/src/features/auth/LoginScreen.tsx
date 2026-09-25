import type { SessionUser } from '@katahimo/shared';
import { useMemo, useState } from 'react';
import { authApi } from '../../api/auth';
import { userMessageOf } from '../../api/client';
import { rememberTenantSlug, resolveTenantFromBrowser } from '../../lib/tenant';
import { alertNative } from '../../ui/confirm';
import { useVisibilityToggle } from '../../ui/useVisibilityToggle';
import { type LoginFormValues, LoginModal } from './LoginModal';
import { ResetRequestModal } from './ResetRequestModal';
import { ResetVerifyModal } from './ResetVerifyModal';

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
  const resolvedTenant = useMemo(() => resolveTenantFromBrowser(), []);
  const showTenantField = resolvedTenant === null;

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

  const tenantSlug = resolvedTenant?.slug ?? login.tenantSlug.trim();

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

  const doCompleteReset = async () => {
    if (!resetCode || !resetNewPassword) {
      setResetVerifyError('全ての項目を入力してください');
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
    />
  );
}
