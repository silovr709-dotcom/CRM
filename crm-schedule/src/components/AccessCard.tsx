// «Доступ и учётные записи»: кто входит, с какой ролью и каким паролем.
// Когда учётных записей нет, роль остаётся простым режимом экрана.
import { useState } from 'react';
import { KeyRound, LockKeyhole, LogOut, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { useApp } from '../store';
import type { RoleId } from '../types';
import { ROLES, roleMeta } from '../lib/roles';
import { MIN_PASSWORD, isWeakCrypto } from '../lib/accounts';
import { fmtDateTime } from '../lib/dates';
import { buildDate, forceUpdate } from '../lib/pwa';

export default function AccessCard() {
  const {
    settings, role, accounts, currentAccount, updateSettings, notify,
    addAccount, updateAccount, removeAccount, logout,
  } = useApp();

  // Первого сотрудника заводим руководителем: он же и настраивает доступ.
  const [draft, setDraft] = useState<{ name: string; role: RoleId; password: string }>({
    name: '', role: (settings.accounts?.length ?? 0) === 0 ? 'owner' : 'manager', password: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const canManage = role.canEditSettings;
  const hasAccounts = accounts.length > 0;

  const create = async () => {
    if (busy) return;
    setBusy(true);
    const problem = await addAccount(draft);
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setDraft({ name: '', role: 'manager', password: '' });
    notify('Сотрудник добавлен. Теперь при открытии приложения нужен пароль');
  };

  const resetPassword = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const problem = await updateAccount(id, { password: newPassword });
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setNewPassword('');
    setResetFor('');
    notify('Новый пароль сохранён');
  };

  return (
    <section className="card access-card" id="access">
      <div className="section-head">
        <div>
          <h2><ShieldCheck size={16} /> Доступ и учётные записи</h2>
          <span className="muted">
            {hasAccounts ? 'вход по паролю, у каждого сотрудника своя роль' : 'пока без пароля — роль просто режим экрана'}
          </span>
        </div>
        {currentAccount && (
          <button type="button" className="btn small ghost" onClick={logout}>
            <LogOut size={14} /> Выйти
          </button>
        )}
      </div>

      {!hasAccounts && (
        <>
          <div className="role-grid" role="radiogroup" aria-label="Роль на этом устройстве">
            {ROLES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={role.id === item.id}
                className={`role-card${role.id === item.id ? ' active' : ''}`}
                onClick={() => {
                  updateSettings({ role: item.id });
                  notify(`Роль: ${item.label}`);
                }}
              >
                <b>{item.label}</b>
                <span className="muted small">{item.hint}</span>
                <ul>
                  {item.sees.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </button>
            ))}
          </div>
          <p className="inline-note">
            Роль пока переключается свободно — это режим экрана. Чтобы разделить доступ
            по-настоящему, заведите сотрудников с паролями: тогда при запуске приложение
            попросит войти, а роль будет браться из учётной записи.
          </p>
        </>
      )}

      {hasAccounts && (
        <>
          <ul className="account-list">
            {accounts.map((account) => {
              const meta = roleMeta(account.role);
              const isMe = currentAccount?.id === account.id;
              return (
                <li key={account.id} className="account-row">
                  <span className="account-avatar" aria-hidden="true"><UserRound size={15} /></span>
                  <span className="account-main">
                    <b>{account.name}{isMe && <i className="account-me">это вы</i>}</b>
                    <span className="muted small">
                      {meta.label}
                      {account.lastLoginAt ? ` · вход ${fmtDateTime(account.lastLoginAt)}` : ' · ещё не входил'}
                    </span>
                  </span>
                  {canManage ? (
                    <span className="account-actions">
                      <select
                        aria-label={`Роль: ${account.name}`}
                        value={account.role}
                        onChange={(event) => void updateAccount(account.id, { role: event.target.value as RoleId })}
                      >
                        {ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                      </select>
                      <button
                        type="button"
                        className="icon-btn small"
                        title="Задать новый пароль"
                        aria-label={`Задать новый пароль: ${account.name}`}
                        onClick={() => { setResetFor(resetFor === account.id ? '' : account.id); setNewPassword(''); setError(''); }}
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn small"
                        title="Удалить сотрудника"
                        aria-label={`Удалить сотрудника: ${account.name}`}
                        onClick={() => {
                          if (!confirm(`Удалить учётную запись «${account.name}»?`)) return;
                          removeAccount(account.id);
                          notify('Сотрудник удалён');
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  ) : (
                    <span className="muted small">{isMe ? 'ваша учётная запись' : ''}</span>
                  )}
                  {resetFor === account.id && canManage && (
                    <span className="account-reset">
                      <input
                        type="password"
                        aria-label={`Новый пароль: ${account.name}`}
                        placeholder={`новый пароль, от ${MIN_PASSWORD} символов`}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn small primary"
                        disabled={busy || newPassword.trim().length < MIN_PASSWORD}
                        onClick={() => void resetPassword(account.id)}
                      >
                        Сохранить
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="inline-note">
            Забыли пароль руководителя? Учётные записи лежат в базе — их можно сбросить,
            только имея доступ к другому устройству с этой базой или к резервной копии.
          </p>
        </>
      )}

      {canManage && (
        <>
          <div className="section-head sub">
            <h3><Plus size={14} /> Добавить сотрудника</h3>
            <span className="muted small">пароль нужен, чтобы войти на телефоне или компьютере</span>
          </div>
          <div className="account-form">
            <label className="field">
              Имя
              <input
                value={draft.name}
                placeholder="например, Сергей"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className="field">
              Роль
              <select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as RoleId })}>
                {ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="field">
              Пароль
              <input
                type="password"
                value={draft.password}
                placeholder={`от ${MIN_PASSWORD} символов`}
                aria-label="Пароль нового сотрудника"
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              />
            </label>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}>
              <LockKeyhole size={14} /> Добавить
            </button>
          </div>
          {error && <p className="login-error" role="alert">{error}</p>}
          {isWeakCrypto() && (
            <p className="inline-note warn-note">
              Браузер не поддерживает надёжное хеширование пароля. Пароль всё равно проверяется,
              но защита слабее — обновите браузер.
            </p>
          )}
        </>
      )}

      <p className="inline-note">
        Пароли хранятся только отпечатком (PBKDF2-SHA256), но база не шифруется: кто имеет доступ
        к браузеру или резервной копии, видит данные. Это разделение доступа, а не сейф.
      </p>

      <div className="access-update">
        <span className="muted small">Версия от {fmtDateTime(buildDate())}</span>
        <button type="button" className="btn small ghost" onClick={() => void forceUpdate()}>
          Обновить приложение
        </button>
      </div>
    </section>
  );
}
