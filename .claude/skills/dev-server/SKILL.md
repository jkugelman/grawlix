---
name: dev-server
description: Grawlix local dev server. Serves the module graph from a stable serve-root symlink with caching disabled (`npx http-server -c-1`) so the browser never serves stale JS/CSS — no hard-refresh, no file-watching, no HMR. One server on port 8000 stays up; to test a worktree, repoint the symlink at that worktree's `site/` and it takes over instantly (reload-only, no restart), self-healing back to main if the served worktree is removed. Runs detached in its own session so it survives `pkill claude`. Args: none = serve the checkout you're in (main, or the worktree you're in); `main` = release back to main; a worktree name/path = serve that worktree; `status`; `stop`. After the server is up it invites an optional personal port-bridge skill (e.g. `mobile-bridge`) to expose the port to other devices on your LAN.
---

# Dev server

The local dev server for Grawlix. It serves the raw module graph over plain HTTP with **caching disabled**, so the browser never serves stale JS/CSS — editing a file and reloading is enough, no `Ctrl-Shift-R`. It runs `npx http-server -c-1`; the `-c-1` sets `Cache-Control: max-age=-1`, which forces the browser to revalidate every request instead of heuristically caching modules. It does **not** watch files or auto-reload — the user reloads the browser themselves (deliberate; no HMR/LiveReload).

## The serve-root symlink (worktree takeover)

The server does **not** serve `site/` directly. It serves a stable symlink:

```
SERVE_LINK = ${XDG_CACHE_HOME:-$HOME/.cache}/grawlix-devserver/live   # → the site/ currently being served
```

One perma-server stays up on port 8000 serving `$SERVE_LINK`. To change **what** it serves, repoint the symlink — the server picks up the new target on the very next request with no restart (with `-c-1`, http-server re-reads per request, so a symlink swap is instant and reload-only). Default target is the repo's main `site/`; running the skill from inside a worktree repoints it at that worktree's `site/`, which "takes over" until released back to main.

Every path is derived from git, so this works in any checkout on any machine:

```
MAIN=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')   # primary worktree = repo root
MAIN_SITE=$MAIN/site
WORKTREES=$MAIN/.claude/worktrees
SERVE_LINK=${XDG_CACHE_HOME:-$HOME/.cache}/grawlix-devserver/live
PORT=8000 (default)                    LOG=/tmp/grawlix-devserver-<port>.log
```

## Resolve the target from the argument

- **no arg** → serve the **current checkout**, inferred from the invoking directory:
  ```
  TOP=$(git rev-parse --show-toplevel 2>/dev/null)
  ```
  If `$TOP` is under `$WORKTREES` → serve `$TOP/site` (the worktree you're in). Otherwise → `$MAIN_SITE`. This is what makes "run it from the worktree and it takes over" work.
- **`main`** → `$MAIN_SITE` (release any worktree override back to main).
- **a worktree name** (a directory that exists under `$WORKTREES`) → `$WORKTREES/<name>/site`.
- **a path** → `<path>/site` if that exists, else `<path>` itself.
- **`status`** → jump to *Status* below (no changes).
- **`stop`** → jump to *Stop* below.
- **a bare number** → override `PORT` (advanced, rarely needed; the perma-server normally stays on 8000). Serves whatever the symlink currently targets.

Call the resolved directory `$TARGET_SITE`. **Self-heal:** if `$TARGET_SITE` doesn't exist — e.g. it resolved to a worktree that was since removed by `/wt merge` or `/wt delete` — fall back to main:
```
[ -d "$TARGET_SITE" ] || TARGET_SITE="$MAIN_SITE"
```

## Start / repoint the server

1. Ensure the symlink dir exists and point the symlink at the target:
   ```
   mkdir -p "$(dirname "$SERVE_LINK")"
   ln -sfn "$TARGET_SITE" "$SERVE_LINK"
   ```
   That swap **is** the "serve this now" action, and it also clears a dangling symlink left by a removed worktree.
2. Make sure the perma-server is up **and serving `$SERVE_LINK`**:
   ```
   if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
     if pgrep -af http-server | grep -qF "$SERVE_LINK"; then
       :   # perma-server already on the symlink root → the repoint above is all that's needed, no restart
     else
       # a foreign or old-style server (serving site/ directly) holds the port → restart it onto the symlink root
       fuser -k "$PORT"/tcp; sleep 1
       start   # (the setsid command below)
     fi
   else
     start
   fi
   ```
   The **start** command runs the server **detached from the agent's process tree**, as an ordinary foreground command (it returns immediately — the `&` backgrounds the server, then the shell exits and the server reparents to init):
   ```
   setsid npx -y http-server "$SERVE_LINK" -a 0.0.0.0 -p "$PORT" -c-1 >"$LOG" 2>&1 </dev/null &
   ```
   `setsid` is the load-bearing part: it puts the server in its own session, so it survives `pkill claude` and the agent/editor restarting. A plain `run_in_background` server is a child of the `claude` process and dies with it — that was the "server keeps stopping" bug. So **do not** use `run_in_background` here, and don't keep a task ID; the server is intentionally not an agent-owned task. `-y` so npx never prompts. It binds `0.0.0.0` so the port is reachable from other devices on the LAN (see the bridge step below); on `localhost` that's transparent. The first run downloads `http-server`; later runs use the npm cache. **Note it always serves `$SERVE_LINK`, never `site/` directly** — that's what makes the symlink swap take over without a restart.
3. If it wasn't already running on the symlink root, verify it responds (poll — a detached first run takes a few seconds while npx fetches http-server):
   ```
   curl -fsS --retry 30 --retry-delay 1 --retry-connrefused -o /dev/null -w "%{http_code}\n" http://localhost:"$PORT"/index.html
   ```
   Prints `200` once it's up. If it never responds, read `$LOG`.

## Optional: expose the port to other devices (soft hook)

The server binds `0.0.0.0`, so it's reachable on the LAN wherever the network allows it directly. If you have a **personal port-bridge skill** — e.g. `mobile-bridge`, which forwards a WSL port to the LAN so a phone can reach it — invoke it now for `$PORT`. Anyone without such a skill can ignore this step; `localhost` serving works regardless.

## Report

Report the desktop URL **and what's being served** (main, or the worktree name — from `readlink -f "$SERVE_LINK"`):
- Desktop browser: `http://localhost:<port>/`
- If a bridge skill ran, relay the LAN/phone URL it printed.

Edits to files under the served `site/` take effect on reload — the server doesn't need restarting, and neither does switching which checkout is served (that's just a symlink swap).

## Status

`/dev-server status` — report without changing anything:
- Current target: `readlink -f "$SERVE_LINK"` (say whether it's main or a worktree; if it dangles, note the served worktree was removed and the next run will fall back to main).
- Whether the server is up: `ss -tlnp | grep ":$PORT "`.
- The desktop URL.

## Stop

`/dev-server stop` — the server is detached (its own session, not an agent task), so there's no task ID; stop it by port:
- `fuser -k <port>/tcp` — default 8000 unless the user said otherwise. Kills whatever's listening (the `node` http-server process), regardless of which conversation started it.
- Confirm the port is free again with `ss -tlnp | grep :<port> || echo "port free"`.
- Repoint the symlink back to main for cleanliness so the next start defaults to main: `ln -sfn "$MAIN_SITE" "$SERVE_LINK"`.

## Notes

- **Don't smoke-test by serving with `python -m http.server`** — serving the module graph only proves the filesystem can read it. This skill exists because `-c-1` (no caching) is what keeps reloads honest.
- Plain HTTP only — no HTTPS, self-signed certs, or anything fancy.
- No auto-reload / HMR by design — the user reloads manually and explicitly didn't want a file watcher.
- Don't smoke-test the page yourself afterward — the user does the visual verification. Your job ends after reporting the URL(s).
- `/wt merge` and `/wt delete` remove worktrees without touching this server; if the one being served vanishes, the symlink dangles and the next `/dev-server` run self-heals back to main.
