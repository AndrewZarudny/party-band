#!/bin/bash
# Starts Fretwise on this Mac if it isn't running yet, then shows it in the browser.
# Run by Fretwise.app (the icon); safe to run again: a running Fretwise is only brought to the front.
. "$(dirname "$0")/env.sh"
cd "$FRETWISE_DIR" || exit 1

up() { curl -s -o /dev/null --max-time 2 "$FRETWISE_URL/"; }
alert() {
  osascript -e "display alert \"Fretwise\" message \"$1\"" >/dev/null 2>&1 || echo "$1" >&2
}

if ! up; then
  if ! node_ok || [ ! -d node_modules ]; then
    alert "Fretwise isn't set up on this Mac yet. Open Terminal, go to the Fretwise folder and run: mac/install.sh"
    exit 1
  fi
  mkdir -p .cache
  nohup node node_modules/vite/bin/vite.js --open false --port "$FRETWISE_PORT" --strictPort >.cache/fretwise.log 2>&1 &
  echo $! >.cache/fretwise.pid
  for _ in $(seq 1 80); do
    up && break
    sleep 0.5
  done
fi

if ! up; then
  alert "Fretwise could not start. The reason is in the file .cache/fretwise.log inside the Fretwise folder."
  exit 1
fi

# Chrome when it is installed (lowest delay, and it can pick the output device); else the default browser.
if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" "$FRETWISE_URL"
else
  open "$FRETWISE_URL"
fi
