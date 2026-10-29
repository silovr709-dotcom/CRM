// Вход на своём сервере (домен фирмы). Показывается только там, где отвечает
// PHP-API: логин/пароль проверяет сервер, роль приходит с сервера.
import { useState } from 'react';
import { KeyRound, LogIn, Server, UserRound } from 'lucide-react';
import { useApp } from '../store';

export default function ServerAuth() {
  const { server, serverLogin, serverSetup, settings } = useApp();
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setup = server.needsSetup;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const problem = setup
      ? await serverSetup(name, login, password)
      : await serverLogin(login, password);
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setPassword('');
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">К</span>
          <span>
            <b>{settings.companyName || 'CRM + График'}</b>
            <span className="muted small">сервер фирмы на своём домене</span>
          </span>
        </div>

        <h1>{setup ? 'Первый вход: создайте руководителя' : 'Вход для сотрудников'}</h1>
        <p className="muted small">
          {setup
            ? 'Это самая первая учётная запись на сервере — руководитель фирмы. Дальше он заведёт остальных сотрудников в «Данных».'
            : 'Введите логин и пароль, которые вам выдал руководитель. Роль и права определит сервер.'}
        </p>

        <form
          className="login-form"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          {setup && (
            <label className="field">
              Ваше имя
              <div className="login-input">
                <UserRound size={15} />
                <input
                  value={name}
                  autoComplete="name"
                  aria-label="Ваше имя"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </label>
          )}
          <label className="field">
            Логин
            <div className="login-input">
              <Server size={15} />
              <input
                value={login}
                autoFocus={!setup}
                autoComplete="username"
                aria-label="Логин"
                onChange={(event) => setLogin(event.target.value)}
              />
            </div>
          </label>
          <label className="field">
            Пароль
            <div className="login-input">
              <KeyRound size={15} />
              <input
                type="password"
                autoFocus={setup}
                autoComplete={setup ? 'new-password' : 'current-password'}
                value={password}
                aria-label="Пароль"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </label>
          {setup && <p className="inline-note">Пароль — не короче 6 символов. Логин лучше латиницей: его удобно вводить с телефона.</p>}
          {error && <p className="login-error" role="alert">{error}</p>}
          {!error && server.error && <p className="login-error" role="alert">{server.error}</p>}
          <button type="submit" className="btn primary login-submit" disabled={busy || !login || !password || (setup && !name)}>
            <LogIn size={16} /> {busy ? 'Проверяем…' : setup ? 'Создать и войти' : 'Войти'}
          </button>
        </form>

        {!setup && (
          <p className="inline-note">
            Нет логина? Попросите руководителя завести учётную запись в «Данных → Сотрудники на сервере».
          </p>
        )}
      </div>
    </div>
  );
}
