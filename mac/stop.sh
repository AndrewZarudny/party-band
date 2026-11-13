#!/bin/bash
# Stops the Fretwise that start.sh started (quitting Fretwise.app runs this).
. "$(dirname "$0")/env.sh"
pidfile="$FRETWISE_DIR/.cache/fretwise.pid"
[ -f "$pidfile" ] || exit 0
pid="$(cat "$pidfile" 2>/dev/null)"
rm -f "$pidfile"
case "$pid" in '' | *[!0-9]*) exit 0 ;; esac
# Only Fretwise's own server: the number may belong to something else after a restart of the Mac.
if ps -p "$pid" -o command= 2>/dev/null | grep -q 'vite'; then
  kill "$pid" 2>/dev/null
fi
exit 0
