// Служебные операции для администратора: состояние системы и резервные копии.

import { Router } from 'express';
import { join } from 'node:path';
import { db } from '../db.js';
import { isAdmin } from '../ctx.js';
import { makeBackup, listBackups, backupsDir } from '../services/backup.js';

const r = Router();

r.use((req, res, next) => {
  if (!isAdmin()) return res.status(403).json({ error: 'Доступно только администратору' });
  next();
});

// Сводка: сколько данных, версия, аптайм — видно на странице «Ещё → Мой аккаунт»
r.get('/info', (req, res) => {
  const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  res.json({
    users: count('users'),
    tasks: count('tasks'),
    projects: count('projects'),
    notes: count('notes'),
    attachments: count('attachments'),
    uptime_sec: Math.round(process.uptime()),
    node: process.version,
    tz: process.env.TZ || 'system',
    backups: listBackups().slice(0, 10),
  });
});

r.get('/backups', (req, res) => res.json(listBackups()));

// Сделать копию прямо сейчас
r.post('/backups', (req, res) => {
  try {
    const file = makeBackup();
    res.status(201).json({ ok: true, name: file.split('/').pop() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Скачать копию (в том числе свежую) — файл .db, который можно открыть
// любым просмотрщиком SQLite или вернуть обратно на сервер.
r.get('/backups/latest/download', (req, res) => {
  let list = listBackups();
  if (!list.length) { try { makeBackup(); list = listBackups(); } catch { /* ниже 404 */ } }
  if (!list.length) return res.status(404).json({ error: 'нет резервных копий' });
  res.download(list[0].path, list[0].name);
});

r.get('/backups/:name/download', (req, res) => {
  const name = String(req.params.name);
  if (!/^organizer-[\w.-]+\.db$/.test(name)) return res.status(400).json({ error: 'плохое имя файла' });
  res.download(join(backupsDir, name), name);
});

export default r;
