#!/usr/bin/env python3
"""Hold an exclusive lock on a file, then exec a command under it.

A stand-in for util-linux `flock`, which macOS does not ship. The lock is held
on an inherited file descriptor across the exec, so the kernel releases it when
the command exits -- including on a crash or a SIGKILL, which is why nothing
here cleans up after itself.

Usage: lock-exec.py <lock-file> <wait-seconds> <command> [args...]
"""

import errno
import fcntl
import os
import sys
import time

POLL_SECONDS = 0.25


def main(argv):
    if len(argv) < 4:
        sys.stderr.write(__doc__)
        return 2

    lock_path, wait_secs, command = argv[1], float(argv[2]), argv[3:]

    fd = os.open(lock_path, os.O_CREAT | os.O_WRONLY, 0o644)
    # Python marks every descriptor it opens close-on-exec (PEP 446). Left that
    # way the lock would be dropped the instant this process is replaced below,
    # and every run would sail straight past a held lock.
    os.set_inheritable(fd, True)

    if not _acquire(fd, wait_secs):
        sys.stderr.write(
            f"with-test-lock: still locked after {wait_secs:g}s. Check for a wedged "
            "test run;\n                override the wait with "
            "GRAWLIX_TEST_LOCK_WAIT=<seconds>.\n"
        )
        return 1

    os.environ["GRAWLIX_TEST_LOCK"] = "1"
    try:
        os.execvp(command[0], command)
    except OSError as e:
        sys.stderr.write(f"with-test-lock: cannot run {command[0]}: {e}\n")
        return 127


def _acquire(fd, wait_secs):
    if _try_lock(fd):
        return True

    sys.stderr.write(
        "with-test-lock: another worktree is running tests, waiting for the lock...\n"
    )
    # Polling rather than a blocking flock + SIGALRM: a signal landing inside the
    # syscall is reported as EINTR on some platforms and silently retried on
    # others, so the timeout would not be reliable.
    deadline = time.monotonic() + wait_secs
    while time.monotonic() < deadline:
        time.sleep(POLL_SECONDS)
        if _try_lock(fd):
            sys.stderr.write("with-test-lock: lock acquired, starting.\n")
            return True
    return False


def _try_lock(fd):
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError as e:
        if e.errno in (errno.EACCES, errno.EAGAIN):
            return False
        raise


if __name__ == "__main__":
    sys.exit(main(sys.argv))
