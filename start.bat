@echo off
cd /d "%~dp0"

REM --- Check Python is installed and actually runs ---
REM Use "python --version" rather than "where python": on Windows, "where"
REM also matches the Microsoft Store App Execution Alias stub, which is not a
REM real Python. "--version" fails on the stub, so this catches that case too.
python --version >nul 2>nul
if errorlevel 1 (
    echo.
    echo Python was not found on this computer.
    echo.
    echo deepZEN-curator needs Python to run its small local web server.
    echo Install "Python 3.12" from the Microsoft Store ^(no admin rights
    echo needed^), or ask IT for Python via Company Portal. Once installed,
    echo close this window and double-click start.bat again.
    echo.
    echo Note: if a Microsoft Store page opens when you type "python", that
    echo means Python is not really installed yet - install it first.
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0build\index.html" (
    echo.
    echo The build\ folder is missing or incomplete.
    echo Make sure you unzipped the full deepZEN-curator-vX.X folder.
    echo.
    pause
    exit /b 1
)

echo.
echo Starting deepZEN-curator at http://localhost:5173
echo Keep this window open while you use the app. Close it to stop.
echo.

start "" /min cmd /c "timeout /t 2 >nul & start """" http://localhost:5173"

python -m http.server 5173 --directory build

echo.
echo ----------------------------------------------------------------
echo The local server has stopped.
echo.
echo If the app never loaded, common causes are:
echo   - Python is not installed (see the message above on the next run).
echo   - Port 5173 is already in use by another program.
echo ----------------------------------------------------------------
echo.
pause
