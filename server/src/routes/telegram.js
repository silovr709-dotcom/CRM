import { Router } from 'express';
import { getSetting, setSetting } from '../db.js';
import { tgStatus, sendMessage } from '../services/telegram.js';
import { llmStatus, llmTest } from '../services/nl/llm.js';

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

// статус LLM-адаптера (ключ — из настроек или env; наружу не отдаётся)
r.get('/llm-status', (req, res) => res.json(llmStatus()));

// сохранить ключ/URL/модель LLM (хранится только в локальной БД)
r.post('/llm-config', (req, res) => {
  if (req.body.key !== undefined) setSetting('llm_api_key', String(req.body.key).trim());
  if (req.body.url !== undefined) setSetting('llm_api_url', String(req.body.url).trim());
  if (req.body.model !== undefined) setSetting('llm_model', String(req.body.model).trim());
  res.json(llmStatus());
});

// проверить ключ реальным запросом
r.post('/llm-test', async (req, res) => res.json(await llmTest()));

export default r;
