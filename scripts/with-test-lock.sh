#!/bin/sh
#
# Run a browser test command under a repo-wide lock, so only one worktree runs
# the suite at a time.
#
# Playwright claims about half the cores as workers. Two worktrees running the
# suite at once oversubscribe the machine and the heavy specs start blowing
# their timeouts -- a false failure indistinguishable from a real one, which
# costs a diagnosis and a re-run. Waiting is strictly cheaper: serialized runs
# each go at full speed, so N of them finish in roughly the time a single
# contended run takes.
#
# Usage: scripts/with-test-lock.sh <command> [args...]

set -eu

run_unlocked() {
  exec "$@"
}

# Real CI gives every job its own runner, so there is nothing to serialize
# against. Locally `CI=1` forces a single worker (docs/testing.md), a long run
# that uses almost no CPU -- exactly the run that must not hold the lock.
if [ -n "${CI:-}" ]; then
  run_unlocked "$@"
fi

# The test scripts nest (test:all -> test:dist -> test:browser). A second
# exclusive flock on the same file from inside the lock would wait on itself
# forever, so an inner invocation has to pass straight through.
if [ -n "${GRAWLIX_TEST_LOCK:-}" ]; then
  run_unlocked "$@"
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "with-test-lock: no flock on PATH, running unserialized" >&2
  run_unlocked "$@"
fi

# Every linked worktree shares one common git dir, and it is never committed --
# so this is the same path from anywhere in the repo, while a second clone gets
# a lock of its own instead of queueing behind this one.
if ! git_common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
  echo "with-test-lock: not a git repo, running unserialized" >&2
  run_unlocked "$@"
fi
lock="$git_common/grawlix-test.lock"

wait_secs=${GRAWLIX_TEST_LOCK_WAIT:-3600}

# fd 9 survives the exec below, so the lock is held for as long as the tests run
# and is released by the kernel when they exit -- including on a crash or a
# ctrl-C, which is why nothing here has to clean it up.
exec 9>"$lock"
if ! flock -n 9; then
  echo "with-test-lock: another worktree is running tests, waiting for the lock..." >&2
  if ! flock -w "$wait_secs" 9; then
    echo "with-test-lock: still locked after ${wait_secs}s. Check for a wedged test run;" >&2
    echo "                override the wait with GRAWLIX_TEST_LOCK_WAIT=<seconds>." >&2
    exit 1
  fi
  echo "with-test-lock: lock acquired, starting." >&2
fi

GRAWLIX_TEST_LOCK=1
export GRAWLIX_TEST_LOCK
exec "$@"
