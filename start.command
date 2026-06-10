#!/bin/bash
# macOS launcher. Double-clickable in Finder (a ".command" file opens in
# Terminal). The first time, macOS Gatekeeper may block double-click on a file
# downloaded by email/zip — right-click the file and choose Open, then Open
# again. See README.txt (RUNNING ON A MAC).
cd "$(dirname "$0")" || exit 1

# --- Check Python 3 is installed ---
if ! command -v python3 >/dev/null 2>&1; then
    echo
    echo "Python 3 was not found on this Mac."
    echo
    echo "deepZEN-curator needs Python to run its small local web server."
    echo "Install it by running this in Terminal:"
    echo
    echo "    xcode-select --install"
    echo
    echo "Click \"Install\" in the dialog that appears, wait for it to finish,"
    echo "then open start.command again."
    echo
    read -n 1 -s -r -p "Press any key to close this window."
    echo
    exit 1
fi

if [ ! -f "build/index.html" ]; then
    echo
    echo "The build/ folder is missing or incomplete."
    echo "Make sure you unzipped the full deepZEN-curator-vX.X folder."
    echo
    read -n 1 -s -r -p "Press any key to close this window."
    echo
    exit 1
fi

echo
echo "Starting deepZEN-curator at http://localhost:5173"
echo "Keep this window open while you use the app. Close it to stop."
echo

# Open Chrome at the app once the server has had a moment to start. Fall back to
# the default browser if Chrome is not installed (the app needs Chrome or Edge).
( sleep 2; open -a "Google Chrome" "http://localhost:5173" 2>/dev/null \
    || open -a "Microsoft Edge" "http://localhost:5173" 2>/dev/null \
    || open "http://localhost:5173" ) &

# Run the server in the foreground so closing this window stops it.
python3 -m http.server 5173 --directory build

echo
echo "----------------------------------------------------------------"
echo "The local server has stopped."
echo
echo "If the app never loaded, common causes are:"
echo "  - The app opened in Safari or Firefox (it needs Chrome or Edge)."
echo "  - Port 5173 is already in use by another program."
echo "----------------------------------------------------------------"
echo
read -n 1 -s -r -p "Press any key to close this window."
echo
