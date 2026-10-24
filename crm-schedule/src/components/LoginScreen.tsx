// Вход по паролю: учётные записи сотрудников заведены в «Данных».
// Экран показывается, пока никто не вошёл на этом устройстве.
import { useState } from 'react';
import { KeyRound, LogIn, UserRound } from 'lucide-react';
import { useApp } from '../store';
import { roleMeta } from '../lib/roles';

export default function LoginScreen() {
  const { accounts, login, settings } = useApp();
  const [selected, setSelected] = useState(() => accounts[0]?.id ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const account = accounts.find((item) => item.id === selected);

  const submit = async () => {
    if (!account || busy) return;
    setBusy(true);
    setError('');
    const problem = await login(account.id, password);
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
            <span className="muted small">вход по паролю</span>
          </span>
        </div>

        <h1>{account ? `Здравствуйте, ${account.name}` : 'Вход'}</h1>
        <p className="muted small">
          Выберите себя и введите пароль. Пароль проверяется на этом устройстве:
          в базе хранится только его отпечаток.
        </p>

        <div className="login-people" role="radiogroup" aria-label="Кто вы">
          {accounts.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected === item.id}
              className={`login-person${selected === item.id ? ' active' : ''}`}
              onClick={() => { setSelected(item.id); setPassword(''); setError(''); }}
            >
              <UserRound size={16} />
              <span>
                <b>{item.name}</b>
                <span className="muted small">{roleMeta(item.role).label}</span>
              </span>
            </button>
          ))}
        </div>

        <form
          className="login-form"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <label className="field">
            Пароль
            <div className="login-input">
              <KeyRound size={15} />
              <input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                aria-label="Пароль"
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button type="submit" className="btn primary login-submit" disabled={busy || !password}>
            <LogIn size={16} /> {busy ? 'Проверяем…' : 'Войти'}
          </button>
        </form>

        <p className="inline-note">
          Пароль забыли? Попросите руководителя задать новый в «Данных → Доступ и учётные записи».
        </p>
      </div>
    </div>
  );
}
