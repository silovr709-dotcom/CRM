export type TaskType = 'task' | 'event' | 'trip' | 'purchase' | 'delivery' | 'work' | 'personal' | 'call' | 'meeting' | 'reminder' | string;
export type TaskStatus = 'inbox' | 'planned' | 'in_progress' | 'done' | 'cancelled' | 'paused';
export type ScheduleMode = 'fixed' | 'flexible' | 'deadline';

export interface Recurrence {
  freq: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'every_n_days' | 'days_of_week';
  interval?: number;
  days?: number[];
  until?: string;
}

export interface Dependency {
  task_id: number;
  depends_on_id: number;
  kind: string;
  dep_title: string;
  dep_status: string;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  schedule_mode: ScheduleMode;
  date: string | null;
  time: string | null;
  duration_min: number | null;
  deadline: string | null;
  project_id: number | null;
  category_id: number | null;
  contact_id: number | null;
  parent_id: number | null;
  location: string;
  location_from: string;
  location_to: string;
  recurrence: Recurrence | null;
  extra: Record<string, unknown> | null;
  postponed_count: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // attached meta
  dependencies?: Dependency[];
  blocked?: boolean;
  subtasks_total?: number;
  subtasks_done?: number;
  project?: { id: number; name: string; color: string } | null;
  category?: { id: number; name: string; color: string; icon: string } | null;
  subtasks?: Task[];
  dependents?: { id: number; title: string; status: string }[];
  notes?: Note[];
  reminders?: Reminder[];
  attention_reason?: string;
  // подсказки «когда выезжать» (экран Сегодня)
  travel_min?: number | null;
  departure_time?: string | null;
}

export interface Attachment {
  id: number; filename: string; mime: string; size: number; created_at: string;
}

export interface StockItem {
  id: number; name: string; qty: number; unit: string; min_qty: number;
  location: string; note: string; project_id: number | null; project_name?: string;
  updated_at: string;
}

export interface StockMove {
  id: number; item_id: number; delta: number; reason: string; project_name?: string; created_at: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'done' | 'archived';
  deadline: string | null;
  color: string;
  icon: string;
  pause_until: string | null;
  tasks_total: number;
  tasks_done: number;
  progress: number;
  next_action: { id: number; title: string; date: string | null; time: string | null; type: string } | null;
  tasks?: Task[];
  notes?: Note[];
  history?: Activity[];
}

export interface Note {
  id: number;
  title: string;
  content: string;
  project_id: number | null;
  task_id: number | null;
  contact_id: number | null;
  category_id: number | null;
  pinned: number;
  created_at: string;
  updated_at: string;
  project_name?: string;
  task_title?: string;
}

export interface Reminder {
  id: number;
  title: string;
  remind_date: string;
  remind_time: string | null;
  task_id: number | null;
  status: string;
}

export interface Category { id: number; name: string; color: string; icon: string; builtin: number; }
export interface Contact { id: number; name: string; phone: string; email: string; address: string; notes: string; }

export interface TemplateStep { id: number; ord: number; title: string; type: string; offset_days: number; workdays: number; duration_min: number | null; depends_prev: number; }
export interface Template { id: number; name: string; description: string; builtin: number; steps: TemplateStep[]; }

export interface Automation {
  id: number; name: string; enabled: number; trigger_type: string;
  conditions: { task_type?: string; title_contains?: string; project_id?: number; category_id?: number };
  action_type: string;
  action_params: { title?: string; offset_days?: number; workdays?: number; type?: string; duration_min?: number };
}

export interface Activity { id: number; entity_type: string; entity_id: number; action: string; details: string; created_at: string; }

export interface TimelineBlock {
  kind: 'task' | 'free';
  start: string;
  end: string;
  minutes?: number;
  task?: Task;
}

export interface TodayView {
  date: string;
  is_today: boolean;
  now_time: string;
  current: Task | null;
  next: Task | null;
  timed: Task[];
  untimed: Task[];
  timeline: TimelineBlock[];
  attention: Task[];
  reminders: Reminder[];
  free_min: number;
  free_slots: { start: string; end: string; minutes: number }[];
  briefing: {
    events_count: number; tasks_count: number; trips_count: number; overdue_count: number;
    free_human: string; top: string[]; first: { time: string; title: string } | null;
  };
  evening: { done_count: number; moved_count: number; undone: { id: number; title: string; type: string }[]; suggestion: string };
}

export interface PlanItem {
  title: string; type: string; date: string; time: string | null; duration_min: number;
  depends_on_prev: boolean; is_reminder: boolean; recurrence: Recurrence | null; schedule_mode: string;
  skip?: boolean;
}

export interface AiResponse {
  kind: 'plan' | 'answer' | 'command' | 'plan_day' | 'unload';
  text?: string;
  summary?: string;
  items?: PlanItem[];
  assumptions?: string[];
  questions?: string[];
  tasks?: Task[];
  // command
  command?: string;
  date?: string;
  title?: string;
  candidates?: Task[];
  need_task?: boolean;
  project_id?: number;
  project_name?: string;
  rule?: Recurrence;
  parts?: number;
  // plan_day
  fixed?: { id: number; title: string; time: string; duration_min: number; type: string }[];
  placed?: { task_id: number; title: string; type: string; date: string; time: string; duration_min: number; overdue: boolean }[];
  unplaced?: { id: number; title: string; type: string; duration_min: number }[];
  reserve_min?: number;
  // unload
  suggestions?: { task_id?: number; task_ids?: number[]; title: string; action: string; to_date?: string; reason: string }[];
}
