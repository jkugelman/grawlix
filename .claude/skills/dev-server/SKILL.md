---
name: dev-server
description: Grawlix local dev server. Serves the module graph from a stable serve-root symlink with caching disabled (`npx http-server -c-1`) so the browser never serves stale JS/CSS — no hard-refresh, no file-watching, no HMR. One server on port 8000 stays up; to test a worktree, repoint the symlink at that worktree's `site/` and it takes over instantly (reload-only, no restart), self-healing back to main if the served worktree is removed. Runs detached in its own session so it survives `pkill claude`. Args: none = serve the checkout you're in (main, or the worktree you're in); `main` = release back to main; a worktree name/path = serve that worktree; `status`; `stop`. After the server is up it invites an optional personal port-bridge skill (e.g. `mobile-bridge`) to expose the port to other devices on your LAN.
---

# Dev server

The local dev server for Grawlix. **All the logic lives in [`dev-server.sh`](dev-server.sh) — run it, don't re-derive it step by step.** It serves the raw module graph over plain HTTP with caching disabled so the browser never serves stale JS/CSS (edit, reload, done — no `Ctrl-Shift-R`, no HMR). The whys — the serve-root symlink, the detached session, the worktree takeover — are documented in the script's header comment; read it if you need the model.

## Run it

```
.claude/skills/dev-server/dev-server.sh [ <arg> ]
```

Run from **within a Grawlix checkout** (the no-arg case reads your working directory). Arguments:

| Arg | Serves |
| --- | --- |
| *(none)* | the checkout you're in — main, or the worktree you're `cd`'d into (which takes over) |
| `main` | main's `site/` (release any worktree override) |
| `<worktree-name>` | that worktree's `site/` (a dir under `.claude/worktrees/`) |
| `<path>` | `<path>/site` if it exists, else `<path>` |
| `status` | report only — what's served + whether the server is up |
| `stop` | kill the server on the port and reset the symlink to main |
| `<port>` | bare number — override the port (advanced; the perma-server normally stays on 8000) |

The script prints `Serving: …`, `Desktop: http://localhost:8000/`, and — if a personal port-bridge is present — the LAN/phone URL. **Relay those lines.** On failure it prints the tail of `/tmp/grawlix-devserver-<port>.log` and exits non-zero; surface that.

`npm run dev` runs this too, with no argument — so it serves whichever checkout you run it from: main from the repo root, that worktree from inside one.

## What the script handles for you

- Derives every path from git; resolves the arg to a target `site/`; self-heals a removed-worktree target back to main.
- Serves a stable symlink (not `site/` directly), so a repoint — the worktree takeover — is picked up on the next request with **no restart**.
- Starts the server in its own session so it survives `pkill claude` (via `setsid` where there is one, else the same syscall through `python3` — macOS ships no `setsid` binary). It is deliberately **not** an agent-owned task: don't launch it with `run_in_background`, don't keep a task ID, and stop it with `stop` (by port), not by killing an agent.
- Soft hook: after start it runs `~/.claude/skills/mobile-bridge/mobile-bridge.sh <port>` if present (a personal, machine-local LAN bridge), else skips silently.

## Notes

- **Don't smoke-test with `python -m http.server`** — serving the graph only proves the filesystem can read it; `-c-1` (no caching) is the whole point.
- **Don't smoke-test the page yourself afterward** — the user does the visual verification. Your job ends after reporting the URL(s).
- No auto-reload / HMR by design — the user reloads manually.
- After `/wt merge` or `/wt delete` removes a served worktree, run `dev-server.sh main` to repoint promptly — the self-heal only kicks in on the *next* run, so a browser/phone left on the old URL keeps 404ing until then.
