import { Router } from 'express';
import { handleMessage } from '../services/nl/assistant.js';
import { executeCommand } from '../services/nl/commands.js';
import { applyPlanItems } from '../services/nl/apply.js';
import { llmAvailable, llmParsePhrase } from '../services/nl/llm.js';

const r = Router();

r.post('/', async (req, res) => {
  const message = String(req.body.message || '');
  try {
    const builtin = handleMessage(message);
    // Если встроенный слой распознал фразу-план и настроен внешний LLM —
    // пробуем более умный разбор; при ошибке остаётся встроенный результат.
    if (builtin.kind === 'plan' && llmAvailable()) {
      const smart = await llmParsePhrase(message);
      if (smart?.items?.length) return res.json(smart);
    }
    res.json(builtin);
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
