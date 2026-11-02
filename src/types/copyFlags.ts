/**
 * A line of on-screen copy marked as needing a manual pass. TEMPORARY dev
 * tooling: made by long-pressing text while flag mode is on (Settings › About),
 * read and resolved by Claude over MCP, then fixed in the repo. Remove the table,
 * store, sheet and tools before the app opens to real users.
 */
export interface CopyFlag {
  id: string;
  /** The string as rendered, which is what Claude greps the source for. */
  text: string;
  /** The route name it was flagged on. */
  screen: string;
  /** What is wrong with it, in the person's words. May be empty. */
  note: string;
  status: 'open' | 'resolved';
  /** What it was changed to, or why it was left. Set when resolved. */
  resolution: string;
  createdAt: string;
}
