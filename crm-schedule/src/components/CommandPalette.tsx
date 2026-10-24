// Быстрый поиск и действия: ⌘K / Ctrl+K из любого места.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays, CheckSquare, Contact, Paperclip, Plus, Search, User, X,
} from 'lucide-react';
import { useApp } from '../store';
import { fmtDate, fmtMoney } from '../lib/dates';
import { statusMeta } from '../lib/crm';
import { createPortal } from 'react-dom';

interface Item {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  run: () => void;
}

export default function CommandPalette(props: {
  onClose: () => void;
  /** tab — сразу открыть нужную вкладку карточки, например «Файлы». */
  onOpenDeal: (id: string, tab?: string) => void;
  onOpenClient: (id: string) => void;
  onView: (view: 'overview' | 'crm' | 'schedule' | 'tasks' | 'reports' | 'data') => void;
  onNewDeal: () => void;
  onNewClient: () => void;
  onNewInstall: () => void;
}) {
  const { deals, clients, clientName } = useApp();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      { id: 'a-deal', group: 'Действия', title: 'Новая сделка', run: props.onNewDeal },
      { id: 'a-client', group: 'Действия', title: 'Новый клиент', run: props.onNewClient },
      { id: 'a-install', group: 'Действия', title: 'Поставить монтаж', run: props.onNewInstall },
      { id: 'a-tasks', group: 'Действия', title: 'Задачи на сегодня', run: () => props.onView('tasks') },
      { id: 'a-schedule', group: 'Перейти', title: 'График монтажей', run: () => props.onView('schedule') },
      { id: 'a-reports', group: 'Перейти', title: 'Отчёты: деньги и конверсия', run: () => props.onView('reports') },
      { id: 'a-crm', group: 'Перейти', title: 'CRM: сделки', run: () => props.onView('crm') },
      { id: 'a-data', group: 'Перейти', title: 'Данные и настройки', run: () => props.onView('data') },
    ];

    const dealItems: Item[] = deals.map((deal) => ({
      id: `d-${deal.id}`,
      group: 'Сделки',
      title: `${deal.title}`,
      subtitle: `${clientName(deal)} · ${statusMeta(deal.status).label}${deal.amount ? ` · ${fmtMoney(deal.amount)}` : ''}`,
      run: () => props.onOpenDeal(deal.id),
    }));

    const clientItems: Item[] = clients.map((client) => ({
      id: `c-${client.id}`,
      group: 'Клиенты',
      title: client.name,
      subtitle: [client.phones[0], client.address].filter(Boolean).join(' · '),
      run: () => props.onOpenClient(client.id),
    }));

    // Файлы ищем по имени: «договор», «эскиз», «чек».
    const fileItems: Item[] = [
      ...deals.flatMap((deal) => (deal.attachments ?? []).map((attachment) => ({
        id: `f-${attachment.id}`,
        group: 'Файлы',
        title: attachment.name,
        subtitle: `${clientName(deal)} · ${deal.title}`,
        run: () => props.onOpenDeal(deal.id, 'files'),
      }))),
      ...clients.flatMap((client) => (client.attachments ?? []).map((attachment) => ({
        id: `fc-${attachment.id}`,
        group: 'Файлы',
        title: attachment.name,
        subtitle: client.name,
        run: () => props.onOpenClient(client.id),
      }))),
    ];

    return [...actions, ...dealItems, ...clientItems, ...fileItems];
  }, [deals, clients, clientName, props]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    if (!needle) return items.slice(0, 12);
    return items
      .map((item) => {
        const haystack = `${item.title} ${item.subtitle ?? ''} ${item.group}`.toLocaleLowerCase('ru-RU');
        const index = haystack.indexOf(needle);
        return { item, score: index < 0 ? -1 : index };
      })
      .filter((entry) => entry.score >= 0)
      .sort((left, right) => left.score - right.score)
      .slice(0, 16)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    element?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { props.onClose(); return; }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((current) => Math.min(filtered.length - 1, current + 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((current) => Math.max(0, current - 1));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = filtered[cursor];
      if (item) {
        props.onClose();
        item.run();
      }
    }
  };

  const iconFor = (group: string) => {
    if (group === 'Сделки') return <CheckSquare size={15} />;
    if (group === 'Клиенты') return <User size={15} />;
    if (group === 'Файлы') return <Paperclip size={15} />;
    if (group === 'Перейти') return <CalendarDays size={15} />;
    return <Plus size={15} />;
  };

  return createPortal(
    <div className="palette-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Поиск и команды">
        <div className="palette-search">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Сделка, клиент, телефон или команда…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Поиск"
          />
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Закрыть"><X size={16} /></button>
        </div>
        <div className="palette-list" ref={listRef} role="listbox">
          {filtered.length === 0 ? (
            <div className="palette-empty">
              <Contact size={18} />
              <span>Ничего не найдено. Попробуйте имя клиента, название заказа или телефон.</span>
            </div>
          ) : filtered.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === cursor}
              data-index={index}
              className={`palette-item${index === cursor ? ' active' : ''}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => { props.onClose(); item.run(); }}
            >
              <span className="palette-icon">{iconFor(item.group)}</span>
              <span className="palette-text">
                <b>{item.title}</b>
                {item.subtitle && <small>{item.subtitle}</small>}
              </span>
              <span className="palette-group">{item.group}</span>
            </button>
          ))}
        </div>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> выбор</span>
          <span><kbd>Enter</kbd> открыть</span>
          <span><kbd>Esc</kbd> закрыть</span>
          <span className="palette-date">{fmtDate(new Date().toISOString().slice(0, 10), { withYear: true })}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
