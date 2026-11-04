/**
 * "Discuss with Claude": a link that opens the Claude app on a new chat with the
 * first message already typed in, for a task or a project.
 *
 * The message names the item and carries its id, so a Claude connected to the
 * person's sync server (see `docs/arch/mcp-server.md`) can pull the live row with
 * `get_task` / `get_project`. The title and a trimmed copy of the notes ride along
 * as well, so the chat is still useful with no connector. Nothing is sent until
 * the person sends the message in Claude, and nothing here touches the network.
 */

/** Notes past this many characters are cut, so the link stays a sane length. */
export const NOTES_LIMIT = 600;

interface Subject {
  id: string;
  title: string;
  notes: string;
}

function trimmedNotes(notes: string): string {
  const text = notes.trim();
  if (!text) return '';
  return text.length > NOTES_LIMIT ? `${text.slice(0, NOTES_LIMIT).trimEnd()}…` : text;
}

function promptFor(kind: 'task' | 'project', { id, title, notes }: Subject): string {
  const name = title.trim() || `untitled ${kind}`;
  const lines = [`Let’s talk about my ${kind} “${name}” in dundundun (id: ${id}).`];
  const body = trimmedNotes(notes);
  if (body) lines.push(`Its notes say: ${body}`);
  lines.push(`If you can, look it up with your dundundun tools first. Then ask what I want to work out.`);
  return lines.join('\n\n');
}

export const taskChatPrompt = (task: Subject): string => promptFor('task', task);
export const projectChatPrompt = (project: Subject): string => promptFor('project', project);

/** The link that opens Claude on a new chat starting with `prompt`. */
export function claudeChatUrl(prompt: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}
