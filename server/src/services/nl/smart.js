// Умный маршрутизатор сообщений ассистента.
// Точные команды («перенеси на пятницу», «распланируй день», «разгрузи день»)
// всегда обрабатывает встроенный слой — он работает с БД напрямую и предсказуем.
// Всё остальное (новые планы, вопросы, разговор) при подключённом LLM идёт
// через нейросеть с контекстом реальных данных; при сбое — тихий фолбэк.

import { handleMessage } from './assistant.js';
import { llmAvailable, llmAssist } from './llm.js';

export async function smartMessage(text) {
  const builtin = handleMessage(text);
  if (['command', 'plan_day', 'unload'].includes(builtin.kind)) return builtin;
  if (llmAvailable()) {
    try {
      const smart = await llmAssist(text);
      if (smart) return smart;
    } catch { /* фолбэк ниже */ }
  }
  return builtin;
}
