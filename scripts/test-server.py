#!/usr/bin/env python3
"""Serve a directory over HTTP for the Playwright suite.

Equivalent to `python3 -m http.server`, minus the per-request access logs that
would flood the test output. Genuine failures (port in use, missing file) raise
rather than routing through log_message, so Playwright's `stderr: 'pipe'` still
surfaces them.

Exits on its own once orphaned. Playwright stops this server when a run ends
normally, but a run that is SIGKILLed -- an agent torn down, a `pkill`, a
session ending mid-suite -- cannot, and the server survives holding its port.
The next run derives the same port from the same directory and dies with
"address already in use", so one killed run wedges every later one until the
stray process is hunted down by hand.

Usage: test-server.py <directory> <port>
"""

import functools
import http.server
import os
import sys
import threading
import time

ORPHAN_POLL_SECONDS = 1.0


def exit_when_orphaned():
    # A reparented process gets ppid 1 (launchd/init), which is the only signal
    # available here -- the parent is gone, so there is nothing left to wait on.
    while True:
        time.sleep(ORPHAN_POLL_SECONDS)
        if os.getppid() == 1:
            os._exit(0)


def main(argv):
    if len(argv) != 3:
        sys.stderr.write(__doc__)
        return 2

    directory, port = argv[1], int(argv[2])

    http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=directory
    )

    threading.Thread(target=exit_when_orphaned, daemon=True).start()
    http.server.test(HandlerClass=handler, port=port, bind="127.0.0.1")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
