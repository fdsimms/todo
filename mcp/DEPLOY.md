# Deploying to Fly.io

How to run the server and payload store in the cloud, so your phone syncs to it and Claude Code
can read your tasks through it. What it costs you in privacy is in
[`docs/arch/mcp-server.md`](../docs/arch/mcp-server.md); read "The privacy consequence, stated
plainly" before doing this.

**What this gets you:** the normal Claude chat (claude.ai, the desktop app and the phone app)
talking to your data through a custom connector (step 7), and Claude Code too (step 6).

**Cost:** Fly has no free allowance for new accounts. A 512 MB machine plus a 1 GB volume is
about $3.85 a month. Check fly.io/docs/about/pricing for current numbers.

Every command runs from the **repo root**. The Docker build needs the whole repo as its context,
because the server runs the app's own code out of `src/`.

## 1. Install flyctl and log in

```bash
brew install flyctl        # or: curl -L https://fly.io/install.sh | sh
fly auth login
```

## 2. Create the app and its volume

App names are global. If `dundundun-mcp` is taken, change `app` in `mcp/fly.toml` first.
`primary_region` is `ewr` (Secaucus, NJ, next to New York); to run somewhere else, change it to
the region nearest you (`fly platform regions` lists them) and use the same region for the volume.

```bash
fly apps create dundundun-mcp
fly volumes create todo_data --size 1 --region ewr --config mcp/fly.toml
```

Fly warns that one volume has no redundancy. Answer yes: SQLite can only live on one machine,
and the data isn't lost if the volume is. Your phone holds the whole database and refills the
server on its next sync.

## 3. Make the tokens

Three secrets, and they must stay different from each other: one lets Claude read, one lets
Claude write, and one lets your devices sync. **Save all three in your password manager now.**
Fly never shows a secret again once it's set.

```bash
MCP_READ=$(openssl rand -hex 32)
MCP_WRITE=$(openssl rand -hex 32)
SYNC=$(openssl rand -hex 32)
echo "Claude read token:  $MCP_READ"
echo "Claude write token: $MCP_WRITE"
echo "Phone sync token:   $SYNC"

fly secrets set --config mcp/fly.toml \
  MCP_AUTH_TOKEN="$MCP_READ" \
  MCP_WRITE_TOKEN="$MCP_WRITE" \
  SYNC_AUTH_TOKEN="$SYNC" \
  SYNC_TOKEN="$SYNC"
```

`SYNC_TOKEN` is the same value as `SYNC_AUTH_TOKEN` on purpose: it's the token the server's own
replica uses to sync with the store beside it. Leave out `MCP_WRITE_TOKEN` if you only want Claude
to read.

## 4. Deploy

```bash
fly deploy . --config mcp/fly.toml
```

Fly builds the image on its own builders, so you don't need Docker installed. The first deploy
takes a few minutes. Check it's up:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://dundundun-mcp.fly.dev/sync/pull
# 401 means it's running and refusing requests without a token, which is right.
```

## 5. Point your phone at it

In the app: **Settings → Data & reset → Sync**.

- **Sync server:** `https://dundundun-mcp.fly.dev`
- **Sync server token:** the phone sync token from step 3
- **Include health logs:** leave it off unless you want Claude to see your mood, medication and
  food logs and your milestones.

Then tap **Sync now**. The first sync sends your whole database, so it can take a moment.

## 6. Connect Claude Code

```bash
claude mcp add --scope user --transport http todo https://dundundun-mcp.fly.dev/mcp \
  --header "Authorization: Bearer <Claude read token>"
```

Use the write token instead if you want Claude to create, complete and reschedule tasks and edit
the grocery list. Then ask Claude Code something like "what's on my list today?"

## 7. Connect the Claude chat

The chat signs in with OAuth: you add the server once, and a page on the server asks for a
password before it lets Claude in. Make the password, save it in your password manager, then set
it on the server:

```bash
openssl rand -base64 24
fly secrets set --config mcp/fly.toml MCP_OAUTH_PASSWORD="<the password>"
```

It has to be at least 16 characters or the connector stays off (the logs say so).

Then on claude.ai: **Settings → Connectors → Add custom connector**. Name it whatever you like
and give it `https://dundundun-mcp.fly.dev/mcp`. Leave the advanced settings empty. Press
**Connect**, enter the password on the page that opens, and tick **Also let it make changes** if
you want Claude to add and complete tasks and edit the grocery list. A connector added on
claude.ai shows up in the phone and desktop apps too.

To cut a connection off, remove the connector in Claude, or change `MCP_OAUTH_PASSWORD` and
delete `/data/oauth.db` on the machine (`fly ssh console --config mcp/fly.toml`) to sign every
connection out.

## 8. Claude Code on your phone (optional)

A Claude Code session started from the Claude iOS app or claude.ai/code runs in the cloud against
this repo, so your laptop's config doesn't reach it. The repo's `.mcp.json` names the server for
those sessions and reads the token from an environment variable, so no token is ever committed.
Two settings on claude.ai make it work, both on the cloud environment your sessions use:

- **Environment variable:** `TODO_MCP_TOKEN` set to the Claude read token (or the write token, if
  you want phone sessions to make changes).
- **Network access:** the environment's policy has to allow `dundundun-mcp.fly.dev`. The default
  policy refuses it, and a refused host looks like the server being down.

Start a new session after changing either; a running one keeps the settings it started with. On
your laptop, Claude Code asks whether to use the repo's `dundundun` server the first time you open
the repo. Decline it there: the `todo` server from step 6 already covers the laptop, and without
`TODO_MCP_TOKEN` set locally the repo's copy can only get a 401.

## Afterwards

- **Logs:** `fly logs --config mcp/fly.toml`
- **Updating the server:** pull `main` and run the deploy command in step 4 again. The data on the
  volume survives a deploy.
- **Changing a token:** run `fly secrets set` with the new value (it restarts the machine), then
  update whichever device or Claude Code config uses it.
- **Starting over:** `fly apps destroy dundundun-mcp` deletes the app, the volume and the copy
  of your data on it.
