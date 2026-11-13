# Sourced by the Mac scripts: finds Node. Apps started from Finder get a bare PATH, so look in the usual places.
# Order: the copy install.sh downloaded into .cache/node (if any), Homebrew, the nodejs.org installer, nvm.
FRETWISE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export FRETWISE_DIR
export PATH="$FRETWISE_DIR/.cache/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
fi
FRETWISE_PORT="${FRETWISE_PORT:-5173}"
FRETWISE_URL="http://localhost:$FRETWISE_PORT"
export FRETWISE_PORT FRETWISE_URL

# True when this Mac's Node is new enough for Fretwise (22 or newer).
node_ok() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ]
}
