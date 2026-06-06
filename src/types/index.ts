export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Priority = 0 | 1 | 2 | 3 | 4;
export type Effort = 0 | 1 | 2 | 3 | 4 | 5;
export type SortOption = 'default' | 'priority' | 'effort-asc' | 'effort-desc' | 'due-date' | 'streak';

export interface Task {
  id: string;
  title: string;
  notes: string;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;

  dueDate: string | null;
  deferUntil: string | null;
  showAfterTime: string | null;

  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  recurrenceDays: number[];
  recurrenceEndDate: string | null;
  recurrenceFromCompletion: boolean;

  tags: string[];
  sortOrder: number;

  focused: boolean;
  priority: Priority;
  effort: Effort;

  // Streaks (recurring tasks only)
  streakCount: number;       // positive = N consecutive completions
  streakDate: string | null; // logical-day ISO string of last completion
}

export type TaskDraft = Omit<Task, 'id' | 'createdAt' | 'completed' | 'completedAt' | 'streakCount' | 'streakDate'>;

export const PRIORITY_LABELS = ['None', 'Low', 'Medium', 'High', 'Urgent'] as const;
export const PRIORITY_COLORS = [
  'transparent',
  '#64D2FF',
  '#30D158',
  '#FF9F0A',
  '#FF453A',
] as const;

export const EFFORT_LABELS = ['—', 'XS', 'S', 'M', 'L', 'XL'] as const;
export const EFFORT_HINTS = ['', '~15min', '~30min', '~1-2hr', '~4hr', 'day+'] as const;
