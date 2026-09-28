import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { User } from '../types';

export default function Login() {
  const { setUser } = useApp();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!login.trim() || !password) return;
    setBusy(true); setError('');
    try {
      const res = await api.post<{ user: User }>('/auth/login', { login: login.trim(), password });
      setUser(res.user);
    } catch (err) {
      setError((err as Error).message || 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 4 }}>
          <span className="brand-mark">☀️</span> Мой<span>День</span>
        </div>
        <p className="small muted" style={{ textAlign: 'center', marginBottom: 18 }}>
          Личный органайзер. Войдите под своим логином.
        </p>
        <div className="field full">
          <label>Логин</label>
          <input autoFocus value={login} onChange={e => setLogin(e.target.value)} autoComplete="username" />
        </div>
        <div className="field full">
          <label>Пароль</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 14, justifyContent: 'center' }}
          disabled={busy} type="submit">
          {busy ? 'Входим…' : 'Войти'}
        </button>
        <p className="small muted mt12" style={{ textAlign: 'center' }}>
          Регистрации нет: аккаунты заводит администратор.
        </p>
      </form>
    </div>
  );
}

// Обязательная смена временного пароля при первом входе
export function ForcePasswordChange() {
  const { user, setUser, toast } = useApp();
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (newPassword !== repeat) { setError('Пароли не совпадают'); return; }
    try {
      const res = await api.post<{ user: User }>('/auth/password', { old_password: oldPassword, new_password: newPassword });
      setUser(res.user);
      toast('Пароль изменён');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!user) return null;

  return (
    <div className="login-screen">
      <form className="card login-card" onSubmit={submit}>
        <h2 style={{ fontSize: 19, marginBottom: 6 }}>Смените пароль</h2>
        <p className="small muted" style={{ marginBottom: 16 }}>
          Вы вошли с временным паролем. Придумайте свой — так аккаунт будет в безопасности.
        </p>
        <div className="field full"><label>Текущий пароль</label>
          <input type="password" autoFocus value={oldPassword} onChange={e => setOld(e.target.value)} /></div>
        <div className="field full"><label>Новый пароль</label>
          <input type="password" value={newPassword} onChange={e => setNew(e.target.value)} /></div>
        <div className="field full"><label>Повторите новый пароль</label>
          <input type="password" value={repeat} onChange={e => setRepeat(e.target.value)} /></div>
        {error && <div className="login-error">{error}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 14, justifyContent: 'center' }} type="submit">
          Сохранить пароль
        </button>
      </form>
    </div>
  );
}
