'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadAuthSession, type AuthSession } from '@/lib/api/authSession';
import { notifyAuthSync } from '@/lib/api/cloudSync';
import {
  ApiError,
  confirmEmailChange,
  forgotPassword,
  login,
  logout,
  register,
  requestEmailChange,
  resetPassword,
} from '@/lib/api/client';
import {
  deletePasskey,
  fetchMe,
  listPasskeys,
  loginWithPasskey,
  registerPasskey,
  type PasskeyItem,
} from '@/lib/api/passkey';
import { passkeySupported } from '@/lib/api/webauthn';
import { Icon } from '@/app/components/icons';
import type { View } from '@/app/trainer/shared';

type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

function readAccountQuery() {
  if (typeof window === 'undefined') return { reset: '', emailConfirm: '' };
  const params = new URLSearchParams(window.location.search);
  return {
    reset: params.get('reset')?.trim() ?? '',
    emailConfirm: params.get('emailConfirm')?.trim() ?? '',
  };
}

function clearAccountQuery() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has('reset') && !url.searchParams.has('emailConfirm')) return;
  url.searchParams.delete('reset');
  url.searchParams.delete('emailConfirm');
  window.history.replaceState(null, '', `${url.pathname}${url.hash}`);
}

export function AccountView({
  announce,
  onNavigate,
}: {
  announce: (message: string) => void;
  onNavigate?: (view: View) => void;
}) {
  const goHomeAfterLogin = useCallback(() => {
    notifyAuthSync('login');
    onNavigate?.('home');
  }, [onNavigate]);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [passkeyName, setPasskeyName] = useState('この端末');
  const [supportsPasskey, setSupportsPasskey] = useState(false);
  useEffect(() => { setSupportsPasskey(passkeySupported()); }, []);
  const isRegister = authMode === 'register';
  const isForgot = authMode === 'forgot';
  const isReset = authMode === 'reset';

  const refreshPasskeys = useCallback(async () => {
    const items = await listPasskeys();
    setPasskeys(items);
  }, []);

  const hydrate = useCallback(async () => {
    const local = loadAuthSession();
    if (!local) return;
    try {
      const me = await fetchMe();
      const next = { ...local, user: me.user };
      setSession(next);
      await refreshPasskeys();
    } catch {
      logout();
      setSession(null);
      setPasskeys([]);
    }
  }, [refreshPasskeys]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the auth session lives in localStorage, only readable after mount
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const query = readAccountQuery();
    if (query.reset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is only readable after mount (SSR markup must match)
      setResetToken(query.reset);
      setAuthMode('reset');
      setSession(null);
      return;
    }
    if (!query.emailConfirm) return;

    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        const next = await confirmEmailChange(query.emailConfirm);
        if (cancelled) return;
        setSession(next);
        await refreshPasskeys();
        goHomeAfterLogin();
        announce('メールアドレスを変更しました');
        clearAccountQuery();
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'メール変更の確認に失敗しました';
        announce(message);
        clearAccountQuery();
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [announce, goHomeAfterLogin, refreshPasskeys]);

  const run = async (action: () => Promise<void>, okMessage: string) => {
    setBusy(true);
    try {
      await action();
      announce(okMessage);
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : '失敗しました';
      announce(message);
    } finally {
      setBusy(false);
    }
  };

  const submitEmailAuth = () => run(async () => {
    const mail = email.trim();
    if (!mail) throw new Error('メールを入力してください');
    if (password.length < 8) throw new Error('パスワードは8文字以上にしてください');
    if (isRegister) {
      const next = await register(mail, password);
      setSession(next);
      setPasskeys([]);
      goHomeAfterLogin();
      return;
    }
    const next = await login(mail, password);
    setSession(next);
    await refreshPasskeys();
    goHomeAfterLogin();
  }, isRegister ? 'アカウントを作成しました' : 'ログインしました');

  if (!session) {
    const title = isReset ? 'パスワード再設定' : isForgot ? 'パスワードを忘れた' : isRegister ? '新規登録' : 'ログイン';

    return (
      <section className="page-pad account-page account-page--auth">
        <div className={`panel panel-pad account-auth-card${!isForgot && !isReset ? ' account-auth-card--wide' : ''}`}>
          <header className="account-auth-head">
            <p className="section-kicker">MEMBER</p>
            <h1>{title}</h1>
          </header>

          {!isForgot && !isReset && <div className="account-auth-info"><section className="account-benefits" aria-label="無料利用と記録の保存について">
            <p className="account-benefits-lead">CWOTはすべて無料。ログインなしでも学べます。</p>
            <dl>
              <div><dt>ログインなし</dt><dd>学習記録は、このブラウザに保存されます。</dd></div>
              <div><dt>ログインすると</dt><dd>学習状況などをサーバーに保存し、別の端末でも続きを学べます。</dd></div>
            </dl>
            <p className="account-note">ブラウザのデータを消すと、ブラウザだけに保存した記録は失われます。</p>
            {onNavigate && <button type="button" className="account-switch-link" onClick={() => onNavigate('home')}>ログインせずに学習を続ける →</button>}
          </section>
              <aside className="account-coming-soon" aria-label="今後の予定">
                <span className="account-coming-soon-label">今後の予定</span>
                <p>アバターやニックネームを登録して、仲間の頑張りが見える学習ログを準備しています。進捗の公開は、希望する方だけが選べる形を予定しています。</p>
              </aside>
          </div>}

          <div className="account-auth-form">
          {isForgot ? (
            <>
              <p className="account-note">登録メールに再設定リンクを送ります。届かない場合は迷惑メールも確認してください。</p>
              <div className="account-auth-fields">
                <label className="account-field">
                  <span className="account-field-label">
                    メール
                    <span className="account-required">必須</span>
                  </span>
                  <input
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={busy}
                    placeholder="you@example.com"
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-block account-auth-submit"
                disabled={busy}
                onClick={() => run(async () => {
                  const mail = email.trim();
                  if (!mail) throw new Error('メールを入力してください');
                  await forgotPassword(mail);
                  setAuthMode('login');
                }, '送信しました。メールを確認してください')}
              >
                再設定メールを送る
              </button>
              <p className="account-switch">
                <button type="button" className="account-switch-link" disabled={busy} onClick={() => setAuthMode('login')}>
                  ログインへ戻る
                </button>
              </p>
            </>
          ) : isReset ? (
            <>
              <p className="account-note">新しいパスワードを入力してください。</p>
              <div className="account-auth-fields">
                <label className="account-field">
                  <span className="account-field-label">
                    新しいパスワード
                    <span className="account-required">必須</span>
                  </span>
                  <span className="account-password-wrap">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={busy}
                      placeholder="8文字以上"
                    />
                    <button
                      type="button"
                      className="account-password-toggle"
                      disabled={busy}
                      aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
                    </button>
                  </span>
                </label>
                {password.length > 0 && password.length < 8 && (
                  <p className="account-note">パスワードはあと {8 - password.length} 文字必要です</p>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary btn-block account-auth-submit"
                disabled={busy}
                onClick={() => run(async () => {
                  if (!resetToken) throw new Error('再設定トークンがありません');
                  if (password.length < 8) throw new Error('パスワードは8文字以上にしてください');
                  await resetPassword(resetToken, password);
                  setPassword('');
                  setResetToken('');
                  setAuthMode('login');
                  clearAccountQuery();
                }, 'パスワードを更新しました。ログインしてください')}
              >
                パスワードを更新
              </button>
              <p className="account-switch">
                <button type="button" className="account-switch-link" disabled={busy} onClick={() => { setAuthMode('login'); clearAccountQuery(); }}>
                  ログインへ戻る
                </button>
              </p>
            </>
          ) : (
            <>
              <div className="account-auth-fields">
                <label className="account-field">
                  <span className="account-field-label">
                    メール
                    <span className="account-required">必須</span>
                  </span>
                  <input
                    type="email"
                    autoComplete="username webauthn"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={busy}
                    placeholder="you@example.com"
                  />
                </label>

                <label className="account-field">
                  <span className="account-field-label">
                    パスワード
                    <span className="account-required">必須</span>
                  </span>
                  <span className="account-password-wrap">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={isRegister ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={busy}
                      placeholder="8文字以上"
                    />
                    <button
                      type="button"
                      className="account-password-toggle"
                      disabled={busy}
                      aria-label={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
                    </button>
                  </span>
                </label>

                {password.length > 0 && password.length < 8 && (
                  <p className="account-note">パスワードはあと {8 - password.length} 文字必要です</p>
                )}

                {!isRegister && (
                  <p className="account-forgot-row">
                    <button type="button" className="account-switch-link" disabled={busy} onClick={() => setAuthMode('forgot')}>
                      パスワードを忘れた場合
                    </button>
                  </p>
                )}
              </div>

              <button
                type="button"
                className="btn btn-primary btn-block account-auth-submit"
                disabled={busy}
                onClick={submitEmailAuth}
              >
                {isRegister ? 'アカウントを作成' : 'ログイン'}
              </button>

              {!isRegister && (
                <>
                  <div className="account-or" role="separator" aria-label="または">
                    <span>または</span>
                  </div>

                  <button
                    type="button"
                    className="btn btn-ghost btn-block account-passkey-btn"
                    disabled={busy || !supportsPasskey}
                    onClick={() => run(async () => {
                      const next = await loginWithPasskey(email.trim() || undefined);
                      setSession(next);
                      await refreshPasskeys();
                      goHomeAfterLogin();
                    }, 'パスキーでログインしました')}
                  >
                    <Icon name="fingerprint" size={20} />
                    パスキーでログイン
                  </button>
                  <p className="account-note account-passkey-hint">
                    {!supportsPasskey
                      ? 'このブラウザはパスキー非対応です。'
                      : '事前に登録したパスキーを使用します。'}
                  </p>
                </>
              )}



              <p className="account-switch">
                {isRegister ? (
                  <>
                    すでにアカウントがある方は{' '}
                    <button type="button" className="account-switch-link" disabled={busy} onClick={() => setAuthMode('login')}>
                      ログインへ
                    </button>
                  </>
                ) : (
                  <>
                    はじめての方は{' '}
                    <button type="button" className="account-switch-link" disabled={busy} onClick={() => setAuthMode('register')}>
                      新規登録へ
                    </button>
                  </>
                )}
              </p>
            </>
          )}
          </div>
        </div>
        <footer className="account-site-footer">
          <nav aria-label="サイト案内">
            <a href="/">サイトトップ</a>
            <a href="/faq">よくある質問</a>
            <a href="/contact">お問い合わせ</a>
          </nav>
          <small>© 2026 Int Design LLC.</small>
        </footer>
      </section>
    );
  }

  return (
    <section className="page-pad account-page">
      <div className="page-title">
        <div>
          <p className="section-kicker">ACCOUNT</p>
          <h1>マイページ</h1>
          <p>ログイン中のアカウントとパスキーを管理します。</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel panel-pad settings-panel">
          <div className="settings-card-head">
            <span className="settings-icon" aria-hidden="true"><Icon name="lock" size={22} /></span>
            <div>
              <p className="section-kicker">PROFILE</p>
              <h2>アカウント</h2>
              <p>ログイン中はクラウド（DB）の学習データを優先します。他端末でも同じ進捗を使えます。</p>
            </div>
          </div>
          <dl className="account-meta">
            <div><dt>メール</dt><dd>{session.user.email}</dd></div>
          </dl>

          <div className="account-email-change">
            <p className="section-kicker">EMAIL CHANGE</p>
            <label className="account-field">
              新しいメール
              <input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                disabled={busy}
                placeholder="new@example.com"
                autoComplete="email"
              />
            </label>
            <label className="account-field">
              現在のパスワード
              <input
                type="password"
                value={emailPassword}
                onChange={(event) => setEmailPassword(event.target.value)}
                disabled={busy}
                autoComplete="current-password"
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => run(async () => {
                const next = newEmail.trim();
                if (!next) throw new Error('新しいメールを入力してください');
                if (!emailPassword) throw new Error('現在のパスワードを入力してください');
                await requestEmailChange(next, emailPassword);
                setNewEmail('');
                setEmailPassword('');
              }, '確認メールを新しいアドレスへ送りました')}
            >
              確認メールを送る
            </button>
            <p className="account-note">新しいメールのリンクを開くと変更が確定します。</p>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => {
              logout();
              setSession(null);
              setPasskeys([]);
              setAuthMode('login');
              notifyAuthSync('logout');
              announce('ログアウトしました');
            }}
          >
            ログアウト
          </button>
        </div>

        <div className="panel panel-pad settings-panel">
          <div className="settings-card-head">
            <span className="settings-icon" aria-hidden="true"><Icon name="key" size={22} /></span>
            <div>
              <p className="section-kicker">PASSKEYS</p>
              <h2>パスキー管理</h2>
              <p>追加・削除はログイン中だけできます。消すとこの端末ではパスキーログインできなくなります。</p>
            </div>
          </div>

          {!supportsPasskey && <p className="account-note">このブラウザはパスキー非対応です。</p>}

          <label className="account-field">
            新しいパスキーの名前
            <input value={passkeyName} onChange={(event) => setPasskeyName(event.target.value)} disabled={busy} maxLength={128} />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !supportsPasskey}
            onClick={() => run(async () => {
              await registerPasskey(passkeyName.trim() || 'Passkey');
              await refreshPasskeys();
            }, 'パスキーを追加しました')}
          >
            パスキーを追加
          </button>

          <ul className="passkey-list">
            {passkeys.length === 0 && <li className="passkey-empty">まだパスキーはありません</li>}
            {passkeys.map((item) => (
              <li key={item.id} className="passkey-item">
                <div>
                  <b>{item.name}</b>
                  <small>
                    作成 {new Date(item.createdAt).toLocaleString('ja-JP')}
                    {item.lastUsedAt ? ` · 最終利用 ${new Date(item.lastUsedAt).toLocaleString('ja-JP')}` : ''}
                  </small>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => run(async () => {
                    await deletePasskey(item.id);
                    await refreshPasskeys();
                  }, 'パスキーを削除しました')}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
