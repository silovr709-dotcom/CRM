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
    expect(rule('.mobile-nav button {', 'min-height')).toContain('min-height: 48px');
  });
});
