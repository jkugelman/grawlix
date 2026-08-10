#!/usr/bin/env python3
"""Hook: flag newly added comment lines so Claude must justify each against
CLAUDE.md's "comments are earned by stakes" rule.

Soft guidance gets skipped because adding a comment is woven into writing the
code rather than being a discrete action. This hook turns it back into a
checkpoint: any added whole-line comment surfaces as feedback Claude has to
answer before moving on.

Edit/Write carry their own before/after in tool_input, so those are judged
straight from it. Bash carries only a command string, and a shell edit (sed
-i, a heredoc, a redirect) would otherwise walk past the checkpoint unseen —
so Bash is judged by snapshotting the worktree's comment lines in PreToolUse
and diffing against a PostToolUse snapshot. Watching the worktree instead of
enumerating tool names is what keeps this closed against whatever edits next:
a bulk sed sweep, a subagent, a future patch tool.

Every failure path exits silently rather than blocking — a hook that can't
tell what changed must not stand in the way of work.
"""
import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

# Comment-bearing languages in this repo. `#` is deliberately absent — too
# ambiguous (CSS hex colors) and grawlix is HTML/CSS/JS anyway.
CODE_EXTS = {
    "html", "htm", "css", "js", "mjs", "cjs", "ts", "jsx", "tsx",
    "c", "h", "cpp", "cc", "hpp", "go", "rs", "java",
}
COMMENT_STARTS = ("//", "/*", "*/", "*", "<!--")

GIT_TIMEOUT = 10
MAX_LISTED = 25


def is_comment_line(line):
    return line.strip().startswith(COMMENT_STARTS)


def is_code_path(path):
    name = os.path.basename(path)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return ext in CODE_EXTS


# ─── Worktree snapshots (the Bash path) ───────────────────────────────

def git(root, *args):
    try:
        proc = subprocess.run(
            ["git", "-C", root, *args],
            capture_output=True, text=True, timeout=GIT_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return proc.stdout if proc.returncode == 0 else None


def repo_root(cwd):
    out = git(cwd, "rev-parse", "--show-toplevel")
    return out.strip() if out else None


def head_sha(root):
    out = git(root, "rev-parse", "HEAD")
    return out.strip() if out else None


def comment_snapshot(root):
    """Comment lines present in the worktree but not in HEAD.

    Keyed by (path, text) with multiplicity, so the same comment in two files
    stays distinguishable and three identical `// TODO`s count three times.
    Returns None if git can't answer, which callers treat as "don't judge".
    """
    counts = Counter()

    patch = git(root, "diff", "HEAD", "--unified=0", "--no-color",
                "--no-ext-diff", "--no-textconv")
    if patch is None:
        return None
    current = None
    for line in patch.splitlines():
        if line.startswith("+++ "):
            target = line[4:].strip()
            current = target[2:] if target.startswith("b/") else None
            if current and not is_code_path(current):
                current = None
        elif current and line.startswith("+") and is_comment_line(line[1:]):
            counts[(current, line[1:].strip())] += 1

    untracked = git(root, "ls-files", "--others", "--exclude-standard")
    if untracked is None:
        return None
    for rel in untracked.splitlines():
        if not rel or not is_code_path(rel):
            continue
        try:
            text = Path(root, rel).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            if is_comment_line(line):
                counts[(rel, line.strip())] += 1

    return counts


def state_path(session_id):
    slug = "".join(c for c in session_id if c.isalnum() or c in "-_")[:64]
    return Path(tempfile.gettempdir(),
                f"grawlix-comment-checkpoint-{slug or 'default'}.json")


def record_pre(data):
    root = repo_root(data.get("cwd") or os.getcwd())
    if not root:
        return
    head, counts = head_sha(root), comment_snapshot(root)
    if head is None or counts is None:
        return
    payload = {"head": head, "lines": [[p, t, n] for (p, t), n in counts.items()]}
    try:
        state_path(data.get("session_id", "")).write_text(
            json.dumps(payload), encoding="utf-8")
    except OSError:
        pass


def added_from_worktree(data):
    path = state_path(data.get("session_id", ""))
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        before_head = payload["head"]
        before = Counter({(p, t): n for p, t, n in payload["lines"]})
    except (OSError, ValueError, KeyError, TypeError):
        return []
    finally:
        # A snapshot serves exactly one command; leaving it behind would let a
        # stale baseline judge some later, unrelated one.
        try:
            path.unlink()
        except OSError:
            pass

    root = repo_root(data.get("cwd") or os.getcwd())
    if not root:
        return []
    # A moved HEAD (commit, checkout, rebase) repoints the diff base, so the
    # two snapshots aren't comparable and every line looks new.
    if head_sha(root) != before_head:
        return []
    after = comment_snapshot(root)
    if after is None:
        return []
    return [text for (_, text), n in (after - before).items() for _ in range(n)]


# ─── tool_input diffing (the Edit/Write path) ─────────────────────────

def added_from_tool_input(tool, inp):
    if not is_code_path(inp.get("file_path", "")):
        return []
    if tool == "Edit":
        old = Counter(inp.get("old_string", "").splitlines())
        candidates = inp.get("new_string", "").splitlines()
    else:
        old = Counter()
        candidates = inp.get("content", "").splitlines()

    added = []
    for line in candidates:
        if not is_comment_line(line):
            continue
        if old[line] > 0:
            old[line] -= 1  # carried over unchanged, not newly added
        else:
            added.append(line.strip())
    return added


# ─── Dispatch ─────────────────────────────────────────────────────────

def block(tool, added):
    shown = added[:MAX_LISTED]
    listing = "\n".join(f"  - {c}" for c in shown)
    if len(added) > len(shown):
        listing += f"\n  …and {len(added) - len(shown)} more"
    reason = (
        f"Comment-checkpoint: this {tool} call added {len(added)} comment line(s):\n"
        f"{listing}\n\n"
        "CLAUDE.md: a comment is earned by stakes — what fails SILENTLY and is "
        "costly to rediscover if it's missing. For each comment above, either "
        "state that justification explicitly, or remove the comment. Narrating "
        "what the code does, and details verifiable by looking at the rendered "
        "result, do not qualify."
    )
    json.dump({"decision": "block", "reason": reason}, sys.stdout)


def main():
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return

    tool = data.get("tool_name", "")

    if data.get("hook_event_name") == "PreToolUse":
        if tool == "Bash":
            record_pre(data)
        return

    if tool in ("Edit", "Write"):
        added = added_from_tool_input(tool, data.get("tool_input", {}))
    elif tool == "Bash":
        added = added_from_worktree(data)
    else:
        return

    if added:
        block(tool, added)


if __name__ == "__main__":
    main()
