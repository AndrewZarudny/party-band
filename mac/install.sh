#!/bin/bash
# Fretwise on a Mac, in one step. After cloning the project:
#
#   party-band/mac/install.sh
#
# It gets Node.js if this Mac has none (a private copy inside this folder, no admin password), installs the app's
# packages, brings in an account file moved from another computer if it finds one, builds Fretwise.app with its
# icon in your Applications folder, and starts it. Run it again after pulling a newer version.
set -u
. "$(dirname "$0")/env.sh"
cd "$FRETWISE_DIR" || exit 1

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
fail() {
  printf '\n\033[31m%s\033[0m\n' "$1" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS. On other systems: npm install, then npm run dev."

# ---- 1. Node.js ----------------------------------------------------------------------
step "1/4  Node.js"
if node_ok; then
  echo "Using Node $(node -v) from $(command -v node)."
else
  case "$(uname -m)" in arm64) arch=arm64 ;; *) arch=x64 ;; esac
  base="https://nodejs.org/dist/latest-v22.x"
  echo "This Mac has no Node.js 22 or newer. Downloading a copy for Fretwise only, from nodejs.org ..."
  line="$(curl -fsSL "$base/SHASUMS256.txt" | grep "darwin-$arch.tar.gz\$")" || fail "Couldn't reach nodejs.org. Check the internet connection and run this again."
  sum="${line%% *}"
  file="${line##* }"
  [ -n "$sum" ] && [ -n "$file" ] || fail "Couldn't find a Node.js download for this Mac."
  mkdir -p .cache
  curl -fL --progress-bar "$base/$file" -o .cache/node.tar.gz || fail "The download stopped. Run this again."
  # The file must be exactly the one nodejs.org lists.
  echo "$sum  .cache/node.tar.gz" | shasum -a 256 -c - >/dev/null || fail "The Node.js download doesn't match its checksum. Run this again."
  rm -rf .cache/node && mkdir -p .cache/node
  tar -xzf .cache/node.tar.gz -C .cache/node --strip-components 1 || fail "Couldn't unpack Node.js."
  rm -f .cache/node.tar.gz
  hash -r
  node_ok || fail "Node.js was downloaded but doesn't run on this Mac."
  echo "Node $(node -v) is in .cache/node (used by Fretwise only)."
fi

# ---- 2. The app's packages -------------------------------------------------------------
step "2/4  Fretwise's packages"
npm install --no-fund --no-audit || fail "Installing the packages failed. Check the internet connection and run this again."

# ---- 3. An account moved from another computer ------------------------------------------
step "3/4  Your account"
if [ -e .cache/accounts.json ]; then
  echo "This Mac already has Fretwise accounts: left as they are."
else
  found=""
  for f in "$FRETWISE_DIR/fretwise-account.tgz" "$HOME/Downloads/fretwise-account.tgz" "$HOME/Desktop/fretwise-account.tgz"; do
    [ -f "$f" ] && found="$f" && break
  done
  if [ -n "$found" ]; then
    # Only the account files, wherever the archive says: nothing outside .cache is written.
    if tar -xzf "$found" -C "$FRETWISE_DIR" .cache/accounts.json .cache/accounts 2>/dev/null || tar -xzf "$found" -C "$FRETWISE_DIR" .cache; then
      echo "Brought in the account from $found."
      echo "Sign in with the same name and password as on the other computer."
    else
      echo "Couldn't unpack $found. Fretwise starts without it; copy the file over again and rerun this."
    fi
  else
    echo "No fretwise-account.tgz in this folder, Downloads or Desktop: Fretwise starts fresh."
    echo "To bring your progress over later, put that file in Downloads and run this again."
  fi
fi

# ---- 4. Fretwise.app -------------------------------------------------------------------
step "4/4  The Fretwise app"
apps="$HOME/Applications"
app="$apps/Fretwise.app"
mkdir -p "$apps"
chmod +x mac/start.sh mac/stop.sh 2>/dev/null
tmp="$(mktemp -d)"
# The project's folder goes into the app as an AppleScript string: escape \ and " for AppleScript,
# then \, & and | once more for the sed replacement below.
esc="$(printf '%s' "$FRETWISE_DIR" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | sed -e 's/\\/\\\\/g' -e 's/[&|]/\\&/g')"
sed "s|__FRETWISE_DIR__|$esc|" mac/Fretwise.applescript >"$tmp/Fretwise.applescript"
# Quit an older copy first, so its files can be replaced.
pkill -f "Fretwise.app/Contents/MacOS/applet" >/dev/null 2>&1
mac/stop.sh
rm -rf "$app"
if osacompile -s -o "$app" "$tmp/Fretwise.applescript"; then
  # The icon: the sizes macOS wants, made from mac/icon.png.
  set_dir="$tmp/Fretwise.iconset"
  mkdir -p "$set_dir"
  ok=1
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s" mac/icon.png --out "$set_dir/icon_${s}x${s}.png" >/dev/null 2>&1 || ok=0
    d=$((s * 2))
    sips -z "$d" "$d" mac/icon.png --out "$set_dir/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || ok=0
  done
  if [ "$ok" = 1 ] && iconutil -c icns "$set_dir" -o "$tmp/Fretwise.icns" 2>/dev/null; then
    cp "$tmp/Fretwise.icns" "$app/Contents/Resources/applet.icns"
    # Newer macOS versions draw applets from an asset catalogue first: without it the .icns is used.
    rm -f "$app/Contents/Resources/Assets.car"
    # The app's contents changed after it was built: sign it again for this Mac, or macOS may refuse to open it.
    codesign --force --deep --sign - "$app" >/dev/null 2>&1
    touch "$app"
  else
    echo "Couldn't make the icon; the app works with the standard script icon."
  fi
  echo "Fretwise.app is in $apps."
  echo "Starting it now. To keep it handy: right-click its Dock icon, Options, Keep in Dock."
  open "$app"
else
  echo "Couldn't build Fretwise.app on this Mac. Fretwise still works: double-click Fretwise.command in this folder."
  rm -rf "$tmp"
  exit 1
fi
rm -rf "$tmp"

printf '\n\033[1mDone.\033[0m Fretwise opens in your browser at %s.\n' "$FRETWISE_URL"
echo "Next time: open Fretwise from Applications, Spotlight or the Dock. Quitting the app stops it."
