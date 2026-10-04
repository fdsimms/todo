/**
 * Links that open the app at the thing a tool just made, changed or read.
 *
 * Every link is `https://<server>/open/<path>?<query>`, standing for the app's
 * own `dundundun://<path>?<query>` (src/utils/deepLinks.ts parses both). https
 * rather than the custom scheme because a chat app turns an https URL into
 * something tappable and may not do that for an unknown scheme. On an iPhone
 * with the app installed, the domain is associated with the app
 * (`ios.associatedDomains`), so iOS opens the app directly and this server
 * never sees the request. Anywhere else (a desktop, a build from before the
 * association) the request lands on `openPage`, which hands off to the scheme
 * or says to open it on the phone.
 *
 * The paths are the app's, and only the ones the app opens a screen for are
 * allowed, so the page can't be used to bounce someone to an arbitrary link.
 */

/** App link paths this server hands out, each of which the app routes. */
export const OPEN_PATHS = ['task', 'project', 'groceries', 'recipe', 'mealplan', 'people'] as const;
export type OpenPath = (typeof OPEN_PATHS)[number];

const SCHEME = 'dundundun';

export interface AppLinks {
  task(id: string): string;
  project(id: string): string;
  groceries(): string;
  recipe(id: string): string;
  mealPlan(dayKey: string): string;
  person(id: string): string;
}

/** Link builders for the server at `base`, or null when it has no public address. */
export function appLinks(base: string | undefined): AppLinks | null {
  if (!base) return null;
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return null;
  }
  const link = (path: OpenPath, params: Record<string, string> = {}) => {
    const url = new URL(`/open/${path}`, origin);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.href;
  };
  return {
    task: id => link('task', { id }),
    project: id => link('project', { id }),
    groceries: () => link('groceries'),
    recipe: id => link('recipe', { id }),
    mealPlan: dayKey => link('mealplan', { date: dayKey }),
    person: id => link('people', { person: id }),
  };
}

/** The app link an `/open/<path>` request stands for, or null for a path the app doesn't open. */
export function appUrlForOpenPath(path: string, search: string): string | null {
  const clean = path.replace(/^\/+|\/+$/g, '');
  if (!(OPEN_PATHS as readonly string[]).includes(clean)) return null;
  const query = search.startsWith('?') ? search : search ? `?${search}` : '';
  return `${SCHEME}://${clean}${query}`;
}

/**
 * Apple's file associating this domain with the app, for `/open/` links only.
 * Null without a team id, since an app id is `<team>.<bundle>` and a guess
 * would associate nothing.
 */
export function appSiteAssociation(teamId: string | undefined, bundleId: string): object | null {
  if (!teamId) return null;
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${bundleId}`],
          components: [{ '/': '/open/*', comment: 'Links the MCP server hands out to open the app.' }],
        },
      ],
    },
  };
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * A string as a JavaScript literal that is safe inside a <script> element: with
 * `<` escaped, a query carrying `</script>` can't end the element early. The
 * query is whatever the link says, and this page shares its origin with the
 * OAuth password page.
 */
function scriptString(s: string): string {
  return JSON.stringify(s).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * What a browser shows for an `/open/` link the app didn't catch: it tries the
 * app's own scheme at once, and offers the same as a button for a browser that
 * wants a tap first.
 */
export function openPage(appUrl: string): string {
  const href = escapeHtml(appUrl);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open in dundundun</title>
<style>
:root { --bg:#f2f2f7; --card:#fff; --text:#000; --muted:#6c6c70; --accent:#007aff; }
@media (prefers-color-scheme: dark) { :root { --bg:#000; --card:#1c1c1e; --text:#fff; --muted:#98989f; --accent:#0a84ff; } }
body { margin:0; background:var(--bg); color:var(--text); font:17px -apple-system, system-ui, sans-serif; }
main { max-width:420px; margin:48px auto; padding:0 16px; }
.card { background:var(--card); border-radius:12px; padding:24px; text-align:center; }
p { color:var(--muted); line-height:1.4; }
a.button { display:block; margin-top:20px; padding:14px; border-radius:10px; background:var(--accent); color:#fff; font-weight:600; text-decoration:none; }
</style></head>
<body><main><div class="card">
<h1>Open in dundundun</h1>
<p>This link opens the dundundun app. On a computer, open it on your phone instead.</p>
<a class="button" href="${href}">Open the app</a>
</div></main>
<script>window.location.replace(${scriptString(appUrl)});</script>
</body></html>`;
}
