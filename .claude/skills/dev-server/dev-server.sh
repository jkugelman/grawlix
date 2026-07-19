#!/usr/bin/env bash
#
# Grawlix local dev server. SKILL.md is the user-facing summary; the whys live
# here next to the code they explain.
#
# Serves the raw module graph over plain HTTP with caching disabled
# (`http-server -c-1` sets Cache-Control: max-age=-1), so the browser never
# serves stale JS/CSS — edit a file, reload, done. No file-watching / HMR by
# design; the user reloads manually.
#
# It does NOT serve site/ directly. One perma-server on $PORT serves a stable
# symlink ($SERVE_LINK). To change WHAT is served, repoint the symlink: with
# -c-1 http-server re-reads per request, so the swap is picked up on the very
# next request with no restart (reload-only). That is what lets a worktree
# "take over" the server instantly.
#
# The server is started with `setsid` so it lands in its own session and
# survives `pkill claude` and the agent/editor restarting — a plain background
# child of the agent process dies with it (that was the "server keeps stopping"
# bug). So it is deliberately NOT an agent-owned task; stop it by port.
#
# Usage: dev-server.sh [ <no-arg> | main | <worktree-name> | <path> | <port> | status | stop ]

set -euo pipefail

# ─── Config — every path derived from git, so this works in any checkout ─────
MAIN=$(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')
if [ -z "${MAIN:-}" ]; then
  echo "dev-server: not inside the Grawlix git repo (cd into a checkout first)" >&2
  exit 1
fi
MAIN_SITE=$MAIN/site
WORKTREES=$MAIN/.claude/worktrees
SERVE_LINK=${XDG_CACHE_HOME:-$HOME/.cache}/grawlix-devserver/live
PORT=8000
BRIDGE=$HOME/.claude/skills/mobile-bridge/mobile-bridge.sh   # optional soft hook

# ─── Resolve the argument ────────────────────────────────────────────────────
# CMD: start (default) | status | stop.  TARGET_SITE: dir to serve, or empty to
# leave the current symlink target untouched (the bare-port case).
ARG=${1:-}
CMD=start
TARGET_SITE=

case "$ARG" in
  "")                                          # no arg → the checkout we're in
    TOP=$(git rev-parse --show-toplevel 2>/dev/null || true)
    case "$TOP" in
      "$WORKTREES"/*) TARGET_SITE=$TOP/site ;; # a worktree → it takes over
      *)              TARGET_SITE=$MAIN_SITE ;;
    esac ;;
  main)      TARGET_SITE=$MAIN_SITE ;;         # release any override back to main
  status|stop)                                 # optional 2nd arg overrides port
    CMD=$ARG
    if [ -n "${2:-}" ]; then PORT=$2; fi ;;
  *[!0-9]*)                                    # has a non-digit → name or path
    if [ -d "$WORKTREES/$ARG" ]; then TARGET_SITE=$WORKTREES/$ARG/site
    elif [ -d "$ARG/site" ];     then TARGET_SITE=$ARG/site
    else                              TARGET_SITE=$ARG
    fi ;;
  *)         PORT=$ARG ;;                       # all digits → override port only
esac

LOG=/tmp/grawlix-devserver-$PORT.log

# Self-heal: a target that resolved to a since-removed worktree falls back to
# main (e.g. after `/wt merge` or `/wt delete`).
if [ -n "$TARGET_SITE" ] && [ ! -d "$TARGET_SITE" ]; then
  TARGET_SITE=$MAIN_SITE
fi

# ─── Helpers ─────────────────────────────────────────────────────────────────
port_in_use() { ss -tlnp 2>/dev/null | grep -q ":$1 "; }

start_server() {
  setsid npx -y http-server "$SERVE_LINK" -a 0.0.0.0 -p "$PORT" -c-1 \
    >"$LOG" 2>&1 </dev/null &
}

describe_target() {   # main | "worktree: <name>" | <path> | dangling note
  local target main_real wt_real
  target=$(readlink -f "$SERVE_LINK" 2>/dev/null || true)
  main_real=$(readlink -f "$MAIN_SITE" 2>/dev/null || true)
  wt_real=$(readlink -f "$WORKTREES" 2>/dev/null || true)
  if [ -z "$target" ] || [ ! -e "$target" ]; then
    printf '(dangling — served worktree was removed; next start falls back to main)'
  elif [ "$target" = "$main_real" ]; then
    printf 'main'
  else
    case "$target" in
      "$wt_real"/*/site) local n=${target#"$wt_real"/}; printf 'worktree: %s' "${n%/site}" ;;
      *)                 printf '%s' "$target" ;;
    esac
  fi
}

run_bridge() {   # expose $PORT to the LAN if a personal port-bridge exists
  [ -x "$BRIDGE" ] && "$BRIDGE" "$PORT" || true
}

# ─── Subcommands ─────────────────────────────────────────────────────────────
do_start() {
  # 1. Point the symlink at the target (bare-port keeps the current target).
  if [ -n "$TARGET_SITE" ]; then
    mkdir -p "$(dirname "$SERVE_LINK")"
    ln -sfn "$TARGET_SITE" "$SERVE_LINK"
  fi

  # 2. Ensure the perma-server is up AND serving $SERVE_LINK.
  local need_start=0
  if port_in_use "$PORT"; then
    if pgrep -af http-server | grep -qF "$SERVE_LINK"; then
      :   # already on the symlink root → the repoint above is the whole job
    else
      fuser -ks "$PORT"/tcp 2>/dev/null || true  # foreign/old-style server → replace
      sleep 1
      need_start=1
    fi
  else
    need_start=1
  fi

  # 3. Start if needed and wait for it (a detached first run fetches http-server).
  if [ "$need_start" = 1 ]; then
    start_server
    if ! curl -fs --retry 30 --retry-delay 1 --retry-connrefused \
             -o /dev/null "http://localhost:$PORT/index.html"; then
      echo "dev-server: server did not come up on $PORT — last log lines:" >&2
      tail -n 20 "$LOG" >&2 2>/dev/null || true
      exit 1
    fi
  fi

  echo "Serving: $(describe_target)"
  echo "Desktop: http://localhost:$PORT/"
  run_bridge
}

do_status() {
  echo "Serving: $(describe_target)"
  if port_in_use "$PORT"; then echo "Server:  up on $PORT"; else echo "Server:  not running on $PORT"; fi
  echo "Desktop: http://localhost:$PORT/"
}

do_stop() {
  fuser -ks "$PORT"/tcp 2>/dev/null || true
  sleep 1
  if port_in_use "$PORT"; then
    echo "dev-server: port $PORT still in use" >&2; exit 1
  fi
  ln -sfn "$MAIN_SITE" "$SERVE_LINK"   # reset to main so the next start defaults there
  echo "Stopped; port $PORT free; symlink reset to main."
}

case "$CMD" in
  status) do_status ;;
  stop)   do_stop ;;
  *)      do_start ;;
esac
