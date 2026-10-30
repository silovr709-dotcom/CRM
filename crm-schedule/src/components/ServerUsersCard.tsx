// Сотрудники на своём сервере: учётки, роли и пароли хранит домен фирмы,
// а не браузер. Руководителю — управление, остальным — только свой вход.
import { useCallback, useEffect, useState } from 'react';
import { LogOut, Plus, Server, Trash2 } from 'lucide-react';
import { useApp } from '../store';
import { ROLES, roleMeta } from '../lib/roles';
import type { RoleId } from '../types';
import {
  loadServerSession, serverCreateUser, serverDeleteUser, serverListUsers,
  serverUpdateUser, type ServerUser,
} from '../lib/server';

export default function ServerUsersCard() {
  const { server, serverLogout, serverSyncNow, serverCheck, notify } = useApp();
  const me = server.user;
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<RoleId>('manager');
  const [newPasswords, setNewPasswords] = useState<Record<string, string>>({});

  const token = () => loadServerSession()?.token ?? '';

  const refresh = useCallback(async () => {
    if (!me || me.role !== 'owner' || !server.available) return;
    setLoading(true);
    try {
      setUsers(await serverListUsers(token()));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось загрузить сотрудников');
    }
    setLoading(false);
  }, [me, server.available]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Сервер не отвечает (например, домашний Wi-Fi не открывает домен), но вход
  // на этом устройстве есть: показываем честную карточку «нет связи», а не
  // прячемся — и не подменяем вид локальными настройками доступа.
  if (!server.available && me) {
    return (
      <section className="card" aria-label="Сотрудники на сервере">
        <div className="section-head">
          <div>
            <h2><Server size={16} /> Сотрудники на сервере</h2>
            <span className="muted">учётные записи и роли хранятся на домене фирмы, вход — с любого устройства</span>
          </div>
        </div>
        <div className="inline-warning">
          Сервер фирмы сейчас не отвечает из этой сети — так бывает на домашнем Wi-Fi,
          который ещё не обновил DNS домена. Вы вошли как {me.name}, данные пока
          сохраняются на этом устройстве и уедут на сервер, когда связь появится.
        </div>
        <div className="data-actions">
          <button
            type="button"
            className="btn small"
            onClick={async () => { notify(await serverCheck(), 'info'); }}
          >
            Проверить связь
          </button>
          <button type="button" className="btn small ghost" onClick={() => { void serverLogout(); }}>
            <LogOut size={14} /> Выйти
          </button>
        </div>
      </section>
    );
  }

  if (!server.available) return null;

  const run = async (action: () => Promise<void>, okText: string) => {
    try {
      await action();
      notify(okText, 'ok');
      await refresh();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Не получилось', 'error');
    }
  };

  const create = () => {
    if (!name.trim() || !login.trim() || password.length < 6) {
      notify('Имя, логин и пароль от 6 символов обязательны', 'error');
      return;
    }
    void run(async () => {
      await serverCreateUser(token(), { name: name.trim(), login: login.trim(), password, role });
      setName(''); setLogin(''); setPassword(''); setRole('manager');
    }, `Сотрудник ${name.trim()} добавлен — пусть войдёт своим логином`);
  };

  return (
    <section className="card" aria-label="Сотрудники на сервере">
      <div className="section-head">
        <div>
          <h2><Server size={16} /> Сотрудники на сервере</h2>
          <span className="muted">учётные записи и роли хранятся на домене фирмы, вход — с любого устройства</span>
        </div>
        <span className={`badge ${server.status === 'error' ? 'badge-amber' : 'badge-green'}`}>
          {server.status === 'syncing' ? 'синхронизация…' : server.status === 'error' ? 'ошибка связи' : 'на связи'}
        </span>
      </div>

      {me && (
        <p className="inline-note">
          Вы вошли как <b>{me.name}</b> ({roleMeta(me.role).label}), логин <code>{me.login}</code>.
          Данные синхронизируются с сервером {server.lastSyncAt ? `· последний обмен ${new Date(server.lastSyncAt).toLocaleString('ru-RU')}` : ''}
          {server.error ? ` · ${server.error}` : ''}
        </p>
      )}

      {me?.role === 'owner' ? (
        <>
          {error && <p className="field-error" role="alert">{error}</p>}
          {loading && <p className="inline-note">Загружаю сотрудников…</p>}
          <ul className="server-user-list">
            {users.map((user) => (
              <li key={user.id} className="server-user">
                <span className="server-user-main">
                  <b>{user.name}</b>
                  <small className="muted">{user.login} · {roleMeta(user.role).label}{user.active ? '' : ' · отключён'}</small>
                </span>
                <select
                  value={user.role}
                  aria-label={`Роль — ${user.name}`}
                  onChange={(event) => {
                    const nextRole = event.target.value as RoleId;
                    void run(async () => { await serverUpdateUser(token(), { id: user.id, role: nextRole }); },
                      `Роль сотрудника ${user.name} изменена`);
                  }}
                >
                  {ROLES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <input
                  type="password"
                  placeholder="новый пароль"
                  autoComplete="new-password"
                  aria-label={`Новый пароль — ${user.name}`}
                  value={newPasswords[user.id] ?? ''}
                  onChange={(event) => setNewPasswords((current) => ({ ...current, [user.id]: event.target.value }))}
                />
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={(newPasswords[user.id] ?? '').length < 6}
                  onClick={() => void run(async () => {
                    await serverUpdateUser(token(), { id: user.id, password: newPasswords[user.id] });
                    setNewPasswords((current) => ({ ...current, [user.id]: '' }));
                  }, `Пароль сотрудника ${user.name} изменён`)}
                >
                  Задать пароль
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => void run(
                    async () => { await serverUpdateUser(token(), { id: user.id, active: !user.active }); },
                    user.active ? `Доступ сотрудника ${user.name} отключён` : `Доступ сотрудника ${user.name} включён`,
                  )}
                >
                  {user.active ? 'Отключить' : 'Включить'}
                </button>
                {user.id !== me.id && (
                  <button
                    type="button"
                    className="icon-btn"
                    title="Удалить сотрудника"
                    aria-label={`Удалить сотрудника ${user.name}`}
                    onClick={() => {
                      if (confirm(`Удалить учётную запись ${user.name}?`)) {
                        void run(() => serverDeleteUser(token(), user.id), `Сотрудник ${user.name} удалён`);
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>

          <div className="form-grid server-new-user">
            <label className="field">Имя сотрудника
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Анна Смирнова" />
            </label>
            <label className="field">Логин
              <input value={login} onChange={(event) => setLogin(event.target.value)} placeholder="anna" autoComplete="off" />
            </label>
            <label className="field">Пароль
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="от 6 символов" autoComplete="new-password" />
            </label>
            <label className="field">Роль
              <select value={role} onChange={(event) => setRole(event.target.value as RoleId)}>
                {ROLES.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.hint}</option>)}
              </select>
            </label>
          </div>
          <div className="actions wrap">
            <button type="button" className="btn small primary" onClick={create}>
              <Plus size={14} /> Добавить сотрудника
            </button>
            <span className="inline-note">Роли на сервере настоящие: монтажник не получит суммы и затраты даже напрямую из API, а менеджер — затраты и себестоимость.</span>
          </div>
        </>
      ) : (
        <p className="inline-note">
          Учётными записями управляет руководитель. Если нужен доступ коллеге или забыли пароль — это к нему.
        </p>
      )}

      <div className="actions wrap">
        <button type="button" className="btn small ghost" onClick={() => void serverSyncNow()}>
          Синхронизировать сейчас
        </button>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => { void serverLogout(); }}
        >
          <LogOut size={14} /> Выйти на этом устройстве
        </button>
      </div>
    </section>
  );
}
