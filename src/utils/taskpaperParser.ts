// Parses a Things 3 TaskPaper export into structured data.
//
// TaskPaper format from Things 3:
//   Area Name:          ← area header (depth 0, ends with ":")
//     Project Name:     ← project header (depth 1, ends with ":")
//       - Task @due(...) @tags(...) @startDate(...)
//         Notes line (plain text, deeper indent)
//         - Checklist item (dash-prefixed, deeper indent)
//       - Standalone task
//     - Area task (no project)
//   Inbox:
//     - Inbox task

export interface ParsedChecklistItem {
  title: string;
}

export interface ParsedTask {
  title: string;
  notes: string;
  tags: string[];
  dueDate: string | null;
  deferUntil: string | null;
  completedAt: string | null;
  someday: boolean;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | null;
  isRecurring: boolean;
  heading: string | null;
  checklistItems: ParsedChecklistItem[];
  areaTag: string | null;
}

export interface ParsedProject {
  name: string;
  tasks: ParsedTask[];
}

export interface ParsedImport {
  projects: ParsedProject[];
  inboxTasks: ParsedTask[];
}

// ─── Attribute extraction ──────────────────────────────────────────────────────

function extractAttr(line: string, name: string): string | null {
  const m = line.match(new RegExp(`@${name}\\(([^)]+)\\)`));
  return m ? m[1].trim() : null;
}

function hasFlag(line: string, name: string): boolean {
  return new RegExp(`@${name}(?:\\(|\\s|$)`).test(line);
}

function extractTags(line: string): string[] {
  const m = line.match(/@tags\(([^)]+)\)/);
  if (!m) return [];
  return m[1].split(',').map(t => t.trim()).filter(Boolean);
}

function stripAttrs(line: string): string {
  return line
    .replace(/@tags\([^)]*\)/g, '')
    .replace(/@\w+\([^)]*\)/g, '')
    .replace(/@\w+/g, '')
    .trim();
}

function indentDepth(line: string): number {
  let depth = 0;
  for (const ch of line) {
    if (ch === '\t') depth++;
    else if (ch === ' ') depth += 0.25; // 4 spaces = 1 tab
    else break;
  }
  return Math.round(depth);
}

// ─── Task line parser ──────────────────────────────────────────────────────────

function parseTaskLine(raw: string, areaTag: string | null, heading: string | null): ParsedTask {
  const dueDate = extractAttr(raw, 'due') ?? extractAttr(raw, 'deadline');
  const deferUntil = extractAttr(raw, 'startDate') ?? extractAttr(raw, 'when');
  const completedAt = extractAttr(raw, 'done');
  const tags = extractTags(raw);

  // @today → treat as due today
  const effectiveDueDate = dueDate ?? (hasFlag(raw, 'today') ? new Date().toISOString().slice(0, 10) : null);

  let timeOfDay: 'morning' | 'afternoon' | 'evening' | null = null;
  if (hasFlag(raw, 'evening')) timeOfDay = 'evening';
  else if (hasFlag(raw, 'morning')) timeOfDay = 'morning';
  else if (hasFlag(raw, 'afternoon')) timeOfDay = 'afternoon';

  const title = stripAttrs(raw.replace(/^\s*-\s*/, ''));

  return {
    title,
    notes: '',
    tags,
    dueDate: effectiveDueDate,
    deferUntil: deferUntil ?? null,
    completedAt: completedAt ?? null,
    someday: hasFlag(raw, 'someday'),
    timeOfDay,
    isRecurring: hasFlag(raw, 'recurring'),
    heading,
    checklistItems: [],
    areaTag,
  };
}

// ─── Main parser ───────────────────────────────────────────────────────────────

export function parseTaskPaper(content: string): ParsedImport {
  const lines = content.split('\n');
  const projects: ParsedProject[] = [];
  const inboxTasks: ParsedTask[] = [];

  let currentArea: string | null = null;
  let currentProject: ParsedProject | null = null;
  let currentHeading: string | null = null;
  let currentTask: ParsedTask | null = null;
  let currentTaskDepth = 0;

  function flushTask() {
    if (!currentTask) return;
    if (currentProject) {
      currentProject.tasks.push(currentTask);
    } else {
      inboxTasks.push(currentTask);
    }
    currentTask = null;
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed === '') continue;

    const depth = indentDepth(rawLine);
    const isTaskLine = /^\s*-\s+/.test(rawLine);
    const isHeader = !isTaskLine && trimmed.endsWith(':');

    if (isHeader) {
      flushTask();
      const name = trimmed.slice(0, -1).trim();
      const nameClean = stripAttrs(name).trim();
      // Remove "Inbox" special header — treat as no project
      if (nameClean.toLowerCase() === 'inbox') {
        currentProject = null;
        currentArea = null;
        currentHeading = null;
        continue;
      }
      if (depth === 0) {
        // Area
        currentArea = nameClean;
        currentProject = null;
        currentHeading = null;
      } else if (depth === 1 && currentArea !== null) {
        // Project inside an area
        currentProject = { name: nameClean, tasks: [] };
        projects.push(currentProject);
        currentHeading = null;
      } else if (depth === 1 && currentArea === null) {
        // Top-level project (no area)
        currentProject = { name: nameClean, tasks: [] };
        projects.push(currentProject);
        currentHeading = null;
      } else if (depth >= 2 && currentProject !== null) {
        // Action Group / heading inside a project
        currentHeading = nameClean;
      }
      continue;
    }

    if (isTaskLine) {
      if (currentTask && depth > currentTaskDepth) {
        // Sub-line of current task — checklist item
        const checkTitle = stripAttrs(trimmed.replace(/^-\s*/, ''));
        if (checkTitle) {
          currentTask.checklistItems.push({ title: checkTitle });
        }
      } else {
        flushTask();
        currentTask = parseTaskLine(rawLine, currentArea, currentHeading);
        currentTaskDepth = depth;
      }
      continue;
    }

    // Plain text → notes for the current task
    if (currentTask && depth > currentTaskDepth) {
      currentTask.notes = currentTask.notes
        ? `${currentTask.notes}\n${trimmed}`
        : trimmed;
    }
  }

  flushTask();
  return { projects, inboxTasks };
}
