#!/bin/bash
# Mac/Linux launcher for use from a terminal:  bash start.sh
# (On a Mac you can also just double-click start.command instead.)
cd "$(dirname "$0")" || exit 1
python3 -m http.server 5173 --directory build &
SERVER_PID=$!
sleep 1
if command -v open >/dev/null 2>&1; then
    open "http://localhost:5173"          # macOS
elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:5173"      # Linux
fi
wait "$SERVER_PID"
