#!/usr/bin/env bash
# Stop the tunnel and the app started by start_public.sh
cd "$(dirname "$0")"
for name in tunnel app; do
  if [ -f "run/$name.pid" ] && kill "$(cat "run/$name.pid")" 2>/dev/null; then
    echo "stopped $name (pid $(cat "run/$name.pid"))"
  fi
  rm -f "run/$name.pid"
done
