import { db } from '../db.js';
import { uid } from '../ctx.js';

export function log(entityType, entityId, action, details = '') {
  db.prepare('INSERT INTO activity_log (entity_type, entity_id, action, details, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(entityType, Number(entityId), action, typeof details === 'string' ? details : JSON.stringify(details), uid());
}

export function getActivity({ entityType, entityId, limit = 100 } = {}) {
  let sql = 'SELECT * FROM activity_log';
  const where = ['user_id = ?'];
  const params = [uid()];
  if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
  if (entityId) { where.push('entity_id = ?'); params.push(Number(entityId)); }
  sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Number(limit));
  return db.prepare(sql).all(...params);
}
