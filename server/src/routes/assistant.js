import { Router } from 'express';
import { smartMessage } from '../services/nl/smart.js';
import { executeCommand } from '../services/nl/commands.js';
import { applyPlanItems } from '../services/nl/apply.js';
import { SUGGESTIONS } from '../services/nl/assistant.js';

const r = Router();

r.post('/', async (req, res) => {
  try {
    res.json(await smartMessage(String(req.body.message || '')));
  } catch (e) {
    console.error(e);
    res.json({ kind: 'answer', text: 'Не смог разобрать запрос. Попробуйте иначе.' });
  }
});

// Чипы-подсказки для окна чата
r.get('/suggestions', (req, res) => res.json({ suggestions: SUGGESTIONS }));

// Подтверждение плана из AI-ввода → реальное создание задач
r.post('/confirm', (req, res) => {
  const created = applyPlanItems(req.body.items || [], req.body.project_id ?? null);
  res.status(201).json({ created });
});

// Подтверждение команды
r.post('/execute', (req, res) => {
  res.json(executeCommand(req.body));
});

export default r;
