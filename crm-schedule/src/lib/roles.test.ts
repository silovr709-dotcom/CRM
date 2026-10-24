// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ROLES, authorLine, authorName, isRole, roleMeta } from './roles';

describe('роли', () => {
  it('описаны по-русски и с разными правами', () => {
    expect(ROLES.map((role) => role.id)).toEqual(['owner', 'manager', 'installer']);
    for (const role of ROLES) {
      expect(role.label.length).toBeGreaterThan(3);
      expect(role.hint.length).toBeGreaterThan(10);
      expect(role.sees.length).toBeGreaterThanOrEqual(4);
    }
    expect(roleMeta('owner').canSeeExpenses).toBe(true);
    expect(roleMeta('manager').canSeeExpenses).toBe(false);
    expect(roleMeta('manager').canSeeMoney).toBe(true);
    expect(roleMeta('installer').canSeeMoney).toBe(false);
    expect(roleMeta('installer').canEditSettings).toBe(false);
  });

  it('понимает неизвестную роль как руководителя', () => {
    expect(roleMeta(undefined).id).toBe('owner');
    expect(roleMeta('owner').canDelete).toBe(true);
    expect(isRole('manager')).toBe(true);
    expect(isRole('boss')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it('подписывает действия именем из настроек', () => {
    expect(authorName({ myName: 'Ирина' })).toBe('Ирина');
    expect(authorName({ myName: '   ' })).toBe('сотрудник');
    expect(authorLine('Ирина', '12.11.2026, 14:05')).toBe('Ирина · 12.11.2026, 14:05');
    expect(authorLine(undefined, '12.11.2026, 14:05')).toBe('12.11.2026, 14:05');
  });
});
