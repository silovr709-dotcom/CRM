import { db } from '../db.js';
import { log } from './activity.js';
import { addDays, addWorkdays, todayStr } from '../util/dates.js';
import { createTask } from './tasks.js';

// Инстанцирование шаблона: создаёт цепочку задач с зависимостями.
export function instantiateTemplate(templateId, { startDate, projectId, contextTitle, contactId, categoryId } = {}) {
  const tpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(Number(templateId));
  if (!tpl) throw new Error('template not found');
  const steps = db.prepare('SELECT * FROM template_steps WHERE template_id = ? ORDER BY ord').all(tpl.id);
  const base = startDate || todayStr();

  const created = [];
  let prevId = null;
  for (const s of steps) {
    const date = s.workdays ? addWorkdays(base, s.offset_days) : addDays(base, s.offset_days);
    const title = contextTitle ? `${s.title} — ${contextTitle}` : s.title;
    const task = createTask({
      title,
      type: s.type,
      date,
      duration_min: s.duration_min,
      project_id: projectId || null,
      contact_id: contactId || null,
      category_id: categoryId || null,
      depends_on: s.depends_prev && prevId ? [prevId] : [],
      description: `Из шаблона «${tpl.name}»`,
    }, { silent: true });
    log('task', task.id, 'created', `шаблон «${tpl.name}»`);
    created.push(task);
    prevId = task.id;
  }
  log('template', tpl.id, 'instantiated', `${steps.length} задач${projectId ? ` в проект #${projectId}` : ''}`);
  return created;
}
