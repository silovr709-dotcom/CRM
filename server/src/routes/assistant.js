import { Router } from 'express';
import { smartMessage } from '../services/nl/smart.js';
import { executeCommand } from '../services/nl/commands.js';
import { applyPlanItems } from '../services/nl/apply.js';

const r = Router();

r.post('/', async (req, res) => {
  try {
    res.json(await smartMessage(String(req.body.message || '')));
  } catch (e) {
    console.error(e);
    res.json({ kind: 'answer', text: 'Не смог разобрать запрос. Попробуйте иначе.' });
  }
});

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
