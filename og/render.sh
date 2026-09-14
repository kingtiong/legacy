#!/bin/bash
# Renders og/og.html to public/og.png (1200x630) for link previews.
# After re-rendering, bump OG_VERSION in app/layout.jsx so apps that cache
# previews fetch the new image.
set -e
cd "$(dirname "$0")/.."
B=${CHROME:-/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell}
"$B" --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --virtual-time-budget=8000 \
  --screenshot="$PWD/public/og.png" "file://$PWD/og/og.html" >/dev/null 2>&1
python3 -c "import struct;d=open('public/og.png','rb').read(24);print('public/og.png', *struct.unpack('>II',d[16:24]))"
