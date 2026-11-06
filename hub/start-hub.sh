#!/usr/bin/env sh
# LAN Collab hub launcher for Linux/macOS. Override with environment variables, e.g.
#   PROJECT=MyProject ROOT=/srv/lan-collab/MyProject PORT=8200 ./start-hub.sh
set -eu
PROJECT="${PROJECT:-MyProject}"
ROOT="${ROOT:-$HOME/lan-collab/workspaces/$PROJECT}"
PORT="${PORT:-8200}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TOKEN_FILE="$HERE/token-$PROJECT.txt"
ALLOW_FILE="$HERE/allowed-accounts-$PROJECT.txt"

command -v node >/dev/null 2>&1 || { echo "[ERROR] Node.js not found. Install Node.js 18 or later."; exit 1; }

# The token is generated once and kept, so invite codes stay valid across restarts.
[ -f "$TOKEN_FILE" ] || node -e "process.stdout.write(require('crypto').randomBytes(12).toString('hex'))" > "$TOKEN_FILE"
LAN_COLLAB_TOKEN="$(cat "$TOKEN_FILE")"
export LAN_COLLAB_TOKEN

if [ ! -f "$ALLOW_FILE" ]; then
  {
    echo "# One account per line: github:username or microsoft:email"
    echo "# Example: github:octocat"
    echo "# A file with only comment lines lets anyone with the token join."
  } > "$ALLOW_FILE"
fi

echo "Project      : $PROJECT"
echo "Folder       : $ROOT"
echo "Token        : $LAN_COLLAB_TOKEN"
echo "Allowed list : $ALLOW_FILE"
exec node "$HERE/hub.js" --root "$ROOT" --port "$PORT" --project "$PROJECT" --allow-file "$ALLOW_FILE"
