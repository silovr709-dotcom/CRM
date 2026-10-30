// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isIosDevice, permissionHint } from './notify';

describe('подсказки по разрешению уведомлений', () => {
  it('разрешено — короткое подтверждение', () => {
    expect(permissionHint('granted', false)).toContain('разрешены');
  });

  it('запрещено — ведём в настройки сайта, а не просим «ещё раз»', () => {
    const hint = permissionHint('denied', false);
    expect(hint).toContain('запретил уведомления');
    expect(hint).toContain('Уведомления');
  });

  it('iPhone без установки — объясняем про экран «Домой»', () => {
    const hint = permissionHint('unsupported', true);
    expect(hint).toContain('iPhone');
    expect(hint).toContain('На экран Домой');
  });

  it('обычный браузер без поддержки — не пугаем, называем запасные каналы', () => {
    const hint = permissionHint('unsupported', false);
    expect(hint).toContain('не поддерживает');
    expect(hint).toContain('звук');
  });

  it('запрос закрыт без ответа — просим выбрать «Разрешить» в окне', () => {
    expect(permissionHint('default', false)).toContain('Разрешить');
  });

  it('isIosDevice не падает без navigator и не считает десктоп iPhone', () => {
    expect(isIosDevice()).toBe(false);
  });
});
