#!/bin/bash
# Fretwise on a Mac, the plain way: double-click this file in Finder and Fretwise runs in a Terminal window
# (close the window to stop it). The usual way is the Fretwise app that mac/install.sh puts in Applications;
# this file is the fallback when that app can't be built, and it shows Fretwise's messages as it runs.
cd "$(dirname "$0")" || exit 1
. mac/env.sh

say_and_wait() {
  echo
  echo "$1"
  echo
  read -r -p "Press Return to close this window. " _
  exit 1
}

node_ok || say_and_wait "Fretwise isn't set up on this Mac yet. In Terminal, run:  $FRETWISE_DIR/mac/install.sh"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "Setting up (first run, or the app was updated). This takes a minute ..."
  npm install --no-fund --no-audit || say_and_wait "Setup failed. Check the internet connection and try again."
fi

echo
echo "Starting Fretwise at $FRETWISE_URL (it opens in your browser)."
echo "Leave this window open while you play. Close it to stop Fretwise."
echo
exec npm run dev
