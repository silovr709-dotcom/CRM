import { Router } from 'express';
import { getSetting, setSetting } from '../db.js';
import { tgStatus, sendMessage } from '../services/telegram.js';

const r = Router();

r.get('/status', async (req, res) => {
  res.json(await tgStatus());
});

r.post('/token', (req, res) => {
  setSetting('telegram_token', String(req.body.token || '').trim());
  if (!req.body.token) setSetting('telegram_chat_id', '');
  res.json({ ok: true });
});

r.post('/test', async (req, res) => {
  const chatId = getSetting('telegram_chat_id', '');
  if (!chatId) return res.json({ ok: false, error: 'Чат не привязан — отправьте боту /start' });
  const out = await sendMessage(chatId, '✅ Тест: органайзер на связи!');
  res.json({ ok: Boolean(out.ok) });
});

export default r;
