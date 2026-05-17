#!/usr/bin/env python3
"""PostToolUse hook: flag comment lines added by an Edit/Write so Claude must
justify each against CLAUDE.md's "comments are earned by stakes" rule.

Soft guidance gets skipped because adding a comment is woven into writing the
code rather than being a discrete action. This hook turns it back into a
checkpoint: any added whole-line comment surfaces as feedback Claude has to
answer before moving on.
"""
import json
import sys
from collections import Counter

# Comment-bearing languages in this repo. `#` is deliberately absent — too
# ambiguous (CSS hex colors) and grawlix is HTML/CSS/JS anyway.
CODE_EXTS = {
    "html", "htm", "css", "js", "mjs", "cjs", "ts", "jsx", "tsx",
    "c", "h", "cpp", "cc", "hpp", "go", "rs", "java",
}
COMMENT_STARTS = ("//", "/*", "*/", "*", "<!--")


def is_comment_line(line):
    return line.strip().startswith(COMMENT_STARTS)


def main():
    try:
        data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return

    tool = data.get("tool_name", "")
    inp = data.get("tool_input", {})
    path = inp.get("file_path", "")
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if ext not in CODE_EXTS:
        return

    if tool == "Edit":
        old = Counter(inp.get("old_string", "").splitlines())
        candidates = inp.get("new_string", "").splitlines()
    elif tool == "Write":
        old = Counter()
        candidates = inp.get("content", "").splitlines()
    else:
        return

    added = []
    for line in candidates:
        if not is_comment_line(line):
            continue
        if old[line] > 0:
            old[line] -= 1  # carried over unchanged, not newly added
        else:
            added.append(line.strip())

    if not added:
        return

    listing = "\n".join(f"  - {c}" for c in added)
    reason = (
        f"Comment-checkpoint: this {tool} added {len(added)} comment line(s):\n"
        f"{listing}\n\n"
        "CLAUDE.md: a comment is earned by stakes — what fails SILENTLY and is "
        "costly to rediscover if it's missing. For each comment above, either "
        "state that justification explicitly, or remove the comment. Narrating "
        "what the code does, and details verifiable by looking at the rendered "
        "result, do not qualify."
    )
    json.dump({"decision": "block", "reason": reason}, sys.stdout)


if __name__ == "__main__":
    main()
