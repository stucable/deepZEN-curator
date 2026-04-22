#!/bin/bash
cd "$(dirname "$0")"
python3 -m http.server 5173 --directory build &
sleep 1 && xdg-open http://localhost:5173
