/**
 * Micro-benchmark of the MCP tool layer against a real replica, no network.
 *
 *   cd mcp && npx tsx bench/bench.ts [taskCount ...]      (default: 1000 10000)
 *
 * Seeds a throwaway database with N tasks (some blocked, some recurring, a few
 * hundred projects' worth of spread across categories and dates), then times
 * every read tool the way `withFresh` runs it: `replica.refresh()` first, then
 * the tool. "Unchanged" rows are the common case (the replica skips its re-read
 * when the file hasn't changed); "after a change" rows write from a second
 * connection first, as a sync landing between two calls would. Reports p50/p95 per tool, plus the pieces (refresh, the task read)
 * so a slow tool can be told apart from a slow floor.
 *
 * It measures the tool layer only. The payload-store sync (`gate.fresh()`) is a
 * network round trip and is timed by the `replica sync:` log lines instead.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

import { installExpoSqliteShim, openReplica, type Replica } from '../src/replica';
import { getTask, listTasks, searchTasks, listProjects, listCategories, listGroceryItems } from '../src/tools';
import { getOverview, getAgenda, reviewTasks, completionHistory } from '../src/insightTools';
import { habitPatterns, moodInsights } from '../src/patternTools';
import { planDay, rebalanceWeek } from '../src/agentTools';

const WORDS = ['pay', 'call', 'buy', 'email', 'fix', 'book', 'clean', 'read', 'plan', 'send', 'renew', 'write'];
const NOUNS = ['rent', 'dentist', 'milk', 'invoice', 'bike', 'flights', 'garage', 'report', 'party', 'form', 'passport', 'taxes'];
const CATS = ['Home', 'Work', 'Health', 'Errands', 'Finance'];

function seed(file: string, from: number, n: number): void {
  const raw = new BetterSqlite3(file);
  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  };
  const insert = raw.prepare(
    `INSERT INTO tasks (id, title, notes, created_at, due_date, tags, category, priority, completed, completed_at, recurrence_type, blocked_by_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  raw.transaction(() => {
    for (let i = from; i < n; i++) {
      const id = `bench-${i}`;
      const done = i % 3 === 0;
      insert.run(
        id,
        `${WORDS[i % WORDS.length]} ${NOUNS[(i * 7) % NOUNS.length]} ${i}`,
        i % 5 === 0 ? 'some notes about this task' : '',
        day(-(i % 400)),
        i % 4 === 0 ? null : day((i % 60) - 20),
        JSON.stringify(i % 6 === 0 ? ['errand'] : []),
        CATS[i % CATS.length],
        i % 4,
        done ? 1 : 0,
        done ? day(-(i % 300)) : null,
        i % 50 === 0 ? 'daily' : 'none',
        i % 40 === 1 ? `bench-${i - 1}` : null
      );
    }
  })();
  raw.close();
}

interface Row { name: string; p50: number; p95: number; runs: number }

function time(name: string, fn: () => unknown, runs: number): Row {
  fn(); // warm: JIT, statement cache
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const row = { name, p50: samples[Math.floor(runs * 0.5)], p95: samples[Math.min(runs - 1, Math.floor(runs * 0.95))], runs };
  // Printed as each finishes: one quadratic tool must not hide the rest.
  console.log(row.name.padEnd(40), row.p50.toFixed(2).padStart(9), row.p95.toFixed(2).padStart(9));
  return row;
}

function suite(replica: Replica, firstId: string, n: number, file: string): Row[] {
  // A write from another connection, as a sync landing between two calls would be.
  const other = new BetterSqlite3(file);
  const touch = () => other.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('bench_touch', ?)").run(String(Math.random()));
  const afterChange = (fn: () => unknown) => () => {
    touch();
    replica.refresh();
    return fn();
  };
  // Each case is `withFresh` shaped: refresh, then the tool.
  const fresh = (fn: () => unknown) => () => {
    replica.refresh();
    return fn();
  };
  const runs = n >= 10000 ? 5 : 40;
  return [
    time('refresh()', () => replica.refresh(), runs),
    time('tasks() after a change (db read)', afterChange(() => replica.tasks()), runs),
    time('tasks() unchanged (cached)', fresh(() => replica.tasks()), runs),
    time('list_tasks today, after a change', afterChange(() => listTasks(replica, { view: 'today' })), runs),
    time('list_tasks today, unchanged', fresh(() => listTasks(replica, { view: 'today' })), runs),
    time('list_tasks later', fresh(() => listTasks(replica, { view: 'later' })), runs),
    time('list_tasks all', fresh(() => listTasks(replica, { view: 'all', includeCompleted: true })), runs),
    time('search_tasks', fresh(() => searchTasks(replica, { query: 'pay rent' })), runs),
    time('get_task', fresh(() => getTask(replica, firstId)), runs),
    time('list_projects', fresh(() => listProjects(replica)), runs),
    time('list_categories', fresh(() => listCategories(replica)), runs),
    time('list_grocery_items', fresh(() => listGroceryItems(replica)), runs),
    time('get_overview', fresh(() => getOverview(replica)), runs),
    time('get_agenda', fresh(() => getAgenda(replica, { days: 7 })), runs),
    time('review_tasks', fresh(() => reviewTasks(replica)), runs),
    time('completion_history', fresh(() => completionHistory(replica)), runs),
    time('habit_patterns', fresh(() => habitPatterns(replica)), runs),
    time('mood_insights', fresh(() => moodInsights(replica)), runs),
    time('plan_day', fresh(() => planDay(replica, { startAt: '09:00', endAt: '17:00' })), runs),
    // Quadratic once today is heavy (buildDeloadPlan runs a snooze suggestion
    // per task over every task): 14s at 2000 tasks. Opt in with BENCH_SLOW=1.
    ...(n <= 1000 || process.env.BENCH_SLOW ? [time('rebalance_week', fresh(() => rebalanceWeek(replica)), n <= 1000 ? runs : 1)] : []),
  ];
  // (connection closed by process exit)
}

function main(): void {
  const sizes = process.argv.slice(2).map(Number).filter(Boolean);
  const dir = mkdtempSync(join(tmpdir(), 'mcp-bench-'));
  const file = join(dir, 'todo.db');
  const replicaRef: { r?: Replica } = {};
  try {
    installExpoSqliteShim(file);
    replicaRef.r = openReplica(file); // creates the schema
    const replica = replicaRef.r;
    let have = 0;
    for (const n of sizes.length ? sizes : [1000, 10000]) {
      // Top up to n rather than reseeding, so sizes run smallest first.
      seed(file, have, n);
      const first = 'bench-0';
      have = n;
      replica.refresh();
      console.log(`\n=== ${n} tasks ===`);
      console.log('tool'.padEnd(40), 'p50 ms'.padStart(9), 'p95 ms'.padStart(9));
      suite(replica, first, n, file);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
