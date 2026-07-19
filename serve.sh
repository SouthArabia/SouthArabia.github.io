#!/bin/zsh
# Local server for Shaib Sport PWA (required — do not open index.html as a file:// URL)
cd "$(dirname "$0")"
PORT="${1:-8080}"
echo "Shaib Sport PWA → http://localhost:$PORT"
python3 -m http.server "$PORT"
