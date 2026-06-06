export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Task {
  id: string;
  title: string;
  notes: string;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;

  // Scheduling
  dueDate: string | null;
  // One-time snooze — hides until this exact datetime, then normal rules apply
  deferUntil: string | null;
  // Daily visibility rule (HH:MM) — task stays hidden until this time every day
  showAfterTime: string | null;

  // Recurrence — applied when the task is completed
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;   // every N days/weeks/months/years
  recurrenceDays: number[];     // for weekly: 0=Sun … 6=Sat
  recurrenceEndDate: string | null;

  tags: string[];
  sortOrder: number;
}

export type TaskDraft = Omit<Task, 'id' | 'createdAt' | 'completed' | 'completedAt'>;
