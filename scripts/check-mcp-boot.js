#!/usr/bin/env node
/**
 * Start the MCP server the way the Fly image does and fail unless it answers
 * HTTP. Run by CI on every PR, since the deploy is the only other place a boot
 * crash shows, and it shows there only after the merge.
 *
 * Jest can't stand in for this: every test mocks expo-sqlite, so a module the
 * server loads too early, a top-level throw, or an import that only fails
 * under tsx all pass the suite and crash the real process. Any HTTP answer
 * counts as up (there is no health route, so it is a 404); the server's own
 * log is printed when it isn't.
 *
 * Needs `npm ci` and `npm ci --prefix mcp` first. Writes only to a temp dir.
 */
const { spawn } = require('child_process');
const { mkdtempSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const PORT = Number(process.env.MCP_BOOT_PORT ?? 18787);
const TIMEOUT_MS = 60_000;
const mcpDir = join(__dirname, '..', 'mcp');
const dataDir = mkdtempSync(join(tmpdir(), 'mcp-boot-'));

let log = '';
const server = spawn(join(mcpDir, 'node_modules', '.bin', 'tsx'), ['src/server.ts'], {
  cwd: mcpDir,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    TODO_DB_PATH: join(dataDir, 'todo.db'),
    SYNC_STORE_PATH: join(dataDir, 'payloads.db'),
    OAUTH_STORE_PATH: join(dataDir, 'oauth.db'),
  },
});
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });

let exited = null;
server.on('exit', (code, signal) => { exited = signal ?? code; });

function finish(ok, message) {
  if (exited === null) server.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
  if (ok) {
    console.log(`check-mcp-boot: ${message}`);
    process.exit(0);
  }
  console.error(`check-mcp-boot: ${message}\n--- server output ---\n${log.trim() || '(none)'}`);
  process.exit(1);
}

(async () => {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    if (exited !== null) return finish(false, `the server exited (${exited}) before answering`);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      return finish(true, `the server answered HTTP ${res.status} after ${Date.now() - started}ms`);
    } catch {
      await new Promise(r => setTimeout(r, 250));
    }
  }
  finish(false, `the server did not answer within ${TIMEOUT_MS / 1000}s`);
})();
