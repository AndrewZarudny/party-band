#!/bin/bash
# Fretwise on a Mac: double-click this file in Finder. It starts Fretwise on this Mac and opens it in the browser.
# Nothing else is needed (no Docker, no database): accounts and songs are kept in the .cache folder next to this file.
# Close the Terminal window (or press Ctrl+C in it) to stop Fretwise.
cd "$(dirname "$0")" || exit 1

say_and_wait() {
  echo
  echo "$1"
  echo
  read -r -p "Press Return to close this window. " _
  exit 1
}

# Node from Homebrew, nvm or the nodejs.org installer: Finder starts this with a bare PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi
command -v node >/dev/null 2>&1 || say_and_wait "Fretwise needs Node.js (version 22 or newer). Install it from https://nodejs.org and double-click this file again."
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || say_and_wait "Fretwise needs Node.js 22 or newer; this Mac has $(node -v). Install the current one from https://nodejs.org and try again."

# An account moved from another computer (made there with: node scripts/export-account.mjs).
# Unpacked once, and only when this Mac has no accounts yet, so it never overwrites what is here.
if [ -f fretwise-account.tgz ] && [ ! -e .cache/accounts.json ]; then
  echo "Bringing in the account from fretwise-account.tgz ..."
  if tar -xzf fretwise-account.tgz; then
    mv fretwise-account.tgz fretwise-account.imported.tgz
    echo "Done. Sign in with the same name and password as on the other computer."
  else
    say_and_wait "Couldn't unpack fretwise-account.tgz. Copy it over again and retry."
  fi
fi

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "Setting up (first run, or the app was updated). This takes a minute ..."
  npm install --no-fund --no-audit || say_and_wait "Setup failed. Check the internet connection and try again."
fi

echo
echo "Starting Fretwise at http://localhost:5173 (it opens in your browser)."
echo "Leave this window open while you play. Close it to stop Fretwise."
echo
exec npm run dev
