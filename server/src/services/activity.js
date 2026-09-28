import { db } from '../db.js';

export function log(entityType, entityId, action, details = '') {
  db.prepare('INSERT INTO activity_log (entity_type, entity_id, action, details) VALUES (?, ?, ?, ?)')
    .run(entityType, Number(entityId), action, typeof details === 'string' ? details : JSON.stringify(details));
}

export function getActivity({ entityType, entityId, limit = 100 } = {}) {
  let sql = 'SELECT * FROM activity_log';
  const where = [];
  const params = [];
  if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
  if (entityId) { where.push('entity_id = ?'); params.push(Number(entityId)); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Number(limit));
  return db.prepare(sql).all(...params);
}
