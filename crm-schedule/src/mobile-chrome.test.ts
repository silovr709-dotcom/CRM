import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Регрессия: приложение ставится на телефон как PWA с viewport-fit=cover,
// поэтому рисуется под чёлкой и статус-баром. Без safe-area-inset-top
// верхняя шапка оказывается в зоне, где по ней физически не нажать.
const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

/** Тело правила с селектором, в котором есть нужное свойство (у селектора несколько блоков). */
function rule(selector: string, needle: string): string {
  let from = 0;
  for (;;) {
    const start = css.indexOf(selector, from);
    expect(start, `нет правила ${selector}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    const body = css.slice(open, close);
    if (body.includes(needle)) return body;
    from = close;
  }
}

describe('мобильная шапка в зоне досягаемости', () => {
  it('страница рисуется на весь экран телефона', () => {
    expect(html).toContain('viewport-fit=cover');
  });

  it('шапка отступает от чёлки и статус-бара', () => {
    expect(rule('.topbar {', 'safe-area-inset-top')).toContain('env(safe-area-inset-top');
  });

  it('кнопки шапки не меньше зоны нажатия пальцем', () => {
    expect(rule('.topbar .icon-btn {', '44px')).toContain('44px');
    expect(rule('.topbar .btn.small {', '44px')).toContain('44px');
  });

  it('открытое меню тоже начинается ниже чёлки', () => {
    expect(rule('.mobile-menu {', 'safe-area-inset-top')).toContain('env(safe-area-inset-top');
    expect(rule('.mobile-menu .icon-btn {', '44px')).toContain('44px');
  });

  it('нижнее меню не перекрыто домашним индикатором', () => {
    expect(rule('.mobile-nav {', 'safe-area-inset-bottom')).toContain('env(safe-area-inset-bottom');
    expect(rule('.mobile-nav button {', 'min-height')).toContain('min-height: 58px');
  });

  it('значки нижнего меню крупные и не ужимаются на узком экране', () => {
    expect(css).toContain('.mobile-nav button svg { width: 24px; height: 24px; }');
    expect(css).not.toContain('.mobile-nav button svg { width: 17px; height: 17px; }');
  });
});

describe('карточки клиента и сделки на телефоне', () => {
  it('окно карточки — шторка снизу на всю ширину', () => {
    expect(rule('.modal-overlay {', 'flex-end')).toContain('align-items: flex-end');
    expect(rule('.modal {', '100dvh')).toContain('border-radius: 18px 18px 0 0');
    expect(css).toContain('animation: sheet 0.22s ease');
  });

  it('поля ввода не вызывают авто-зум iOS и удобны для пальца', () => {
    expect(css).toContain("input:not([type='checkbox']):not([type='radio']), select { min-height: 50px; }");
    expect(css).toContain('input, select, textarea { font-size: 16px; padding: 12px 13px; }');
  });

  it('вкладки карточки — одна прокручиваемая закреплённая строка', () => {
    expect(css).toContain('.modal .tabs {');
    expect(css).toContain('overflow-x: auto; scrollbar-width: none;');
    expect(css).toContain('.modal .tabs button { flex: none; min-height: 40px;');
  });

  it('шапка карточки компактная: одна строка, действия — иконками', () => {
    expect(css).toContain('.modal-head { padding: 10px 14px 8px;');
    expect(css).toContain('white-space: nowrap; overflow: hidden; text-overflow: ellipsis;');
    expect(css).toContain('.modal .deal-head-actions .btn {');
    expect(css).toContain('.deal-head-actions { flex-wrap: nowrap;');
  });

  it('кнопки действий в подвале карточки крупные', () => {
    expect(css).toContain('.modal-foot .btn { min-height: 50px;');
    expect(css).toContain('.modal-head .icon-btn { width: 40px; height: 40px;');
  });
});
