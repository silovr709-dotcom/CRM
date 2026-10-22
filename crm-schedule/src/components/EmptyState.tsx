// Пустое состояние: объясняет, что здесь будет, и предлагает следующий шаг.
import type { ReactNode } from 'react';

export default function EmptyState(props: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${props.compact ? ' compact' : ''}`}>
      {props.icon && <div className="empty-icon">{props.icon}</div>}
      <b>{props.title}</b>
      {props.hint && <p>{props.hint}</p>}
      {props.action && <div className="empty-action">{props.action}</div>}
    </div>
  );
}
