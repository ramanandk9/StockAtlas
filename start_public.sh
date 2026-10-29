#!/usr/bin/env bash
# Start the site on a high local port and expose it through a Cloudflare quick tunnel.
# Not a system service: run this again after a reboot.  Stop with ./stop_public.sh
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-42338}"
mkdir -p run

if [ -f run/app.pid ] && kill -0 "$(cat run/app.pid)" 2>/dev/null; then
  echo "App already running (pid $(cat run/app.pid)) on port $PORT"
else
  PORT="$PORT" PYTHONUNBUFFERED=1 nohup .venv/bin/python app.py > run/app.log 2>&1 &
  echo $! > run/app.pid
  echo -n "Starting app on 127.0.0.1:$PORT "
  for _ in $(seq 1 90); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; echo -n .; sleep 2; done
  echo
fi

if [ -f run/tunnel.pid ] && kill -0 "$(cat run/tunnel.pid)" 2>/dev/null; then
  echo "Tunnel already running (pid $(cat run/tunnel.pid))"
else
  : > run/tunnel.log
  nohup bin/cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" > run/tunnel.log 2>&1 &
  echo $! > run/tunnel.pid
  echo -n "Opening Cloudflare tunnel "
  for _ in $(seq 1 45); do grep -qo "https://[a-z0-9-]*\.trycloudflare\.com" run/tunnel.log && break; echo -n .; sleep 1; done
  echo
fi

URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' run/tunnel.log | head -1 || true)"
echo "${URL:-Tunnel URL not found yet; check run/tunnel.log}" | tee run/public_url.txt
